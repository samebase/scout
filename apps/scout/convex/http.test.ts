import staticHosting from "@convex-dev/static-hosting/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

const renderer = vi.hoisted(() => ({ load: vi.fn(), fetch: vi.fn() }));

// Run the real component queries in the test root alongside Scout's HTTP router.
vi.mock("./_generated/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_generated/api")>();
  const { anyApi } = await import("convex/server");
  return {
    ...original,
    components: {
      ...original.components,
      staticHosting: {
        lib: {
          getCurrentDeployment: anyApi["lib"]["getCurrentDeployment"],
          resolveAssetForHttp: anyApi["lib"]["resolveAssetForHttp"],
        },
      },
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("TANSTACK_SERVER_ENABLED", undefined);
  vi.stubEnv("CONVEX_SITE_URL", "https://preview.convex.site");
  vi.doMock("../dist/server/server.js", () => {
    renderer.load();
    return { default: { fetch: renderer.fetch } };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(staticHosting.schema, {
    ...staticHosting.modules,
    "./component/http.ts": () => import("./http"),
  });
  const bodies = new Map<string, string>();
  await backend.run(async (ctx) => {
    for (const asset of [
      { path: "/index.html", contentType: "text/html", body: "Scout app shell" },
      { path: "/about/index.html", contentType: "text/html", body: "About Scout" },
      {
        path: "/assets/app-a1b2c3d4.js",
        contentType: "text/javascript",
        body: "console.log('Scout')",
      },
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
      bodies.set(url, asset.body);
    }
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new Request(input).url;
      const body = bodies.get(url);
      if (body === undefined) throw new Error(`Unexpected fetch: ${url}`);
      return new Response(body);
    }),
  );
  return backend;
}

test.each([
  "/",
  "/?site=example",
  "/about",
  "/sites/example.com?scope=public",
  "/future/customer.v2",
  "/missing.png",
])("TanStack receives unmatched URL %s before static rewrites and shell fallback", async (path) => {
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "true");
  renderer.fetch.mockResolvedValue(
    new Response("Rendered document", {
      headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" },
    }),
  );
  const backend = await setup();
  const response = await backend.fetch(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("Rendered document");
  expect(renderer.fetch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      url: expect.stringContaining(path),
    }),
  );
});

test.each([undefined, "false"])(
  "static mode %s bypasses even a broken renderer",
  async (setting) => {
    vi.stubEnv("TANSTACK_SERVER_ENABLED", setting);
    renderer.load.mockImplementation(() => {
      throw new Error("Renderer cannot initialize");
    });
    const backend = await setup();
    for (const { path, body } of [
      { path: "/", body: "Scout app shell" },
      { path: "/?site=example&scope=public", body: "Scout app shell" },
      { path: "/about", body: "About Scout" },
      { path: "/about/", body: "About Scout" },
      { path: "/sites/example.com?scope=public", body: "Scout app shell" },
      { path: "/future/customer.v2", body: "Scout app shell" },
      { path: "/missing.png", body: "Scout app shell" },
    ]) {
      const response = await backend.fetch(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    }
    expect(renderer.load).not.toHaveBeenCalled();
  },
);

test("assets and existing Convex endpoints bypass TanStack", async () => {
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "true");
  renderer.load.mockImplementation(() => {
    throw new Error("Renderer cannot initialize");
  });
  const backend = await setup();
  const asset = await backend.fetch("/assets/app-a1b2c3d4.js");
  expect(asset.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect(await asset.text()).toBe("console.log('Scout')");
  const auth = await backend.fetch("/.well-known/openid-configuration");
  expect(auth.status).toBe(200);
  expect(await auth.json()).toMatchObject({ issuer: "https://preview.convex.site" });
  const { default: http } = await import("./http");
  expect(http.lookup("/polar/events", "POST")?.[2]).toBe("/polar/events");
  expect(renderer.load).not.toHaveBeenCalled();
});

test.each([404, 500, 307])("preserves TanStack status %s and response headers", async (status) => {
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "true");
  renderer.fetch.mockResolvedValue(
    new Response("TanStack response", {
      status,
      headers: { Location: "/about", "Set-Cookie": "example=value; HttpOnly; SameSite=Lax" },
    }),
  );
  const backend = await setup();
  const response = await backend.fetch("/unknown/route.pdf");
  expect(response.status).toBe(status);
  expect(response.headers.get("Location")).toBe("/about");
  expect(response.headers.get("Set-Cookie")).toBe("example=value; HttpOnly; SameSite=Lax");
  expect(await response.text()).toBe("TanStack response");
});

test("switching off recovers from initialization failure without rebuilding", async () => {
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "true");
  renderer.load.mockImplementation(() => {
    throw new Error("Renderer cannot initialize");
  });
  const backend = await setup();
  await expect(backend.fetch("/sites/example.com")).rejects.toThrow();
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "false");
  const response = await backend.fetch("/sites/example.com");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Scout app shell");
  expect(renderer.load).toHaveBeenCalledTimes(1);
});

test("accepts TanStack redirects with immutable headers", async () => {
  vi.stubEnv("TANSTACK_SERVER_ENABLED", "true");
  renderer.fetch.mockResolvedValue(Response.redirect("https://preview.convex.site/about", 308));
  const backend = await setup();
  const response = await backend.fetch("//about");
  expect(response.status).toBe(308);
  expect(response.headers.get("Location")).toBe("https://preview.convex.site/about");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("switching off and back on changes the next request", async () => {
  const backend = await setup();
  renderer.fetch.mockImplementation(() => new Response("TanStack document"));
  for (const enabled of [true, false, true]) {
    vi.stubEnv("TANSTACK_SERVER_ENABLED", String(enabled));
    const response = await backend.fetch("/sites/example.com");
    expect(await response.text()).toBe(enabled ? "TanStack document" : "Scout app shell");
  }
});
