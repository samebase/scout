import { registerStaticRoutes } from "@convex-dev/static-hosting";
import staticHosting from "@convex-dev/static-hosting/test";
import { anyApi, httpRouter } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { rewritePrerenderPath } from "./prerender.config";

afterEach(() => vi.unstubAllGlobals());

async function setup(spaFallback = true) {
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
    "./component/http.ts": async () => ({ default: http }),
  });
  const storedBodies = new Map<string, string>();
  await backend.run(async (ctx) => {
    for (const asset of [
      { path: "/index.html", contentType: "text/html", body: "Scout app shell" },
      { path: "/about/index.html", contentType: "text/html", body: "About Scout" },
      { path: "/assets/app.js", contentType: "text/javascript", body: "console.log('Scout')" },
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
])("HTML navigation to %s loads the app without a hosting route rule", async (path) => {
  const backend = await setup();
  const response = await backend.fetch(path, {
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html");
  expect(response.headers.get("Vary")).toBe("Accept");
  expect(await response.text()).toBe("Scout app shell");
});

test.each([
  { path: "/assets/app.js", body: "console.log('Scout')", contentType: "text/javascript" },
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

test.each([
  { path: "/assets/missing.js", accept: "*/*" },
  { path: "/missing.png", accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
  { path: "/sites/example.com/data.json", accept: "application/json" },
])("missing resources return 404 at $path", async ({ path, accept }) => {
  const backend = await setup();
  const response = await backend.fetch(path, { headers: { Accept: accept } });
  expect(response.status).toBe(404);
  expect(response.headers.get("Vary")).toBe("Accept");
  expect(await response.text()).toBe("Not Found");
});

test("the hosting SPA setting disables HTML navigation fallback", async () => {
  const backend = await setup(false);
  const response = await backend.fetch("/future/customer.v2", { headers: { Accept: "text/html" } });
  expect(response.status).toBe(404);
});

test("conditional HTML requests preserve the navigation cache variation", async () => {
  const backend = await setup();
  const response = await backend.fetch("/future/customer.v2", { headers: { Accept: "text/html" } });
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Fixture HTML response is missing an ETag");
  const unchanged = await backend.fetch("/future/customer.v2", {
    headers: { Accept: "text/html", "If-None-Match": etag },
  });
  expect(unchanged.status).toBe(304);
  expect(unchanged.headers.get("Vary")).toBe("Accept");
});
