import { registerStaticRoutes } from "@convex-dev/static-hosting";
import staticHosting from "@convex-dev/static-hosting/test";
import { anyApi, httpRouter } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { rewritePrerenderPath } from "./prerender.config";

afterEach(() => vi.unstubAllGlobals());

async function setup(spaFallback = true, serving: "app" | "component" = "app") {
  const http = httpRouter();
  // Run the component's real functions in the test root alongside its HTTP adapter.
  registerStaticRoutes(
    http,
    {
      lib: {
        getCurrentDeployment: anyApi.lib.getCurrentDeployment,
        resolveAssetForHttp: anyApi.lib.resolveAssetForHttp,
      },
    },
    { spaFallback, rewritePath: rewritePrerenderPath },
  );
  const backend = convexTest(staticHosting.schema, {
    ...staticHosting.modules,
    ...(serving === "app" ? { "./component/http.ts": async () => ({ default: http }) } : {}),
  });
  const storedBodies = new Map<string, string>();
  await backend.run(async (ctx) => {
    for (const asset of [
      { path: "/index.html", contentType: "text/html", body: "Scout app shell" },
      { path: "/about/index.html", contentType: "text/html", body: "About Scout" },
      {
        path: "/assets/app-a1b2c3d4.js",
        contentType: "text/javascript",
        body: "console.log('Scout')",
      },
      { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *" },
    ]) {
      const storageId = await ctx.storage.store(new Blob([asset.body]));
      await ctx.db.insert("staticAssets", {
        path: asset.path,
        contentType: asset.contentType,
        storageId,
        deploymentId: "test",
      });
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Fixture storage URL is missing");
      storedBodies.set(url, asset.body);
    }
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new Request(input).url;
      const body = storedBodies.get(url);
      if (body === undefined) throw new Error(`Unexpected storage fetch: ${url}`);
      return new Response(body);
    }),
  );
  return backend;
}

test.each([
  "/sites/necessary-cobra-892.convex.site?scope=public",
  "/sites/example.com/?scope=mine",
  "/tasks/review-123",
  "/settings",
  "/scouts/scout-name",
  "/future-route/nested/customer.v2?tab=details",
  "/another-new-route/report.pdf",
  "/assets/missing-b5e0f667.js",
  "/missing.png",
  "/sites/example.com/data.json",
])("unmatched path %s loads the app shell", async (path) => {
  const backend = await setup();
  const response = await backend.fetch(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
  expect(await response.text()).toBe("Scout app shell");
});

test.each([
  { path: "/assets/app-a1b2c3d4.js", body: "console.log('Scout')", contentType: "text/javascript" },
  { path: "/robots.txt", body: "User-agent: *", contentType: "text/plain" },
  { path: "/about", body: "About Scout", contentType: "text/html" },
])(
  "uploaded files and prerenders take precedence at $path",
  async ({ path, body, contentType }) => {
    const backend = await setup();
    const response = await backend.fetch(path, { headers: { Accept: "text/html,*/*" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(await response.text()).toBe(body);
  },
);

test.each(["text/html", "*/*", "image/*", "application/json"])(
  "fallback ignores Accept: %s",
  async (accept) => {
    const backend = await setup();
    const response = await backend.fetch("/future/customer.v2", { headers: { Accept: accept } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Scout app shell");
  },
);

test("the hosting SPA setting disables shell fallback", async () => {
  const backend = await setup(false);
  const response = await backend.fetch("/future/customer.v2", { headers: { Accept: "text/html" } });
  expect(response.status).toBe(404);
});

test("conditional requests revalidate the shell", async () => {
  const backend = await setup();
  const response = await backend.fetch("/future/customer.v2", { headers: { Accept: "text/html" } });
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Fixture HTML response is missing an ETag");
  const unchanged = await backend.fetch("/future/customer.v2", {
    headers: { Accept: "text/html", "If-None-Match": etag },
  });
  expect(unchanged.status).toBe(304);
  expect(unchanged.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
});

test("uploaded hashed assets keep their immutable caching", async () => {
  const backend = await setup();
  const response = await backend.fetch("/assets/app-a1b2c3d4.js");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect(await response.text()).toBe("console.log('Scout')");
});

test("component-owned HTTP serving uses the same fallback and shell caching", async () => {
  const backend = await setup(true, "component");
  const response = await backend.fetch("/assets/missing-b5e0f667.js");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
  expect(await response.text()).toBe("Scout app shell");
});
