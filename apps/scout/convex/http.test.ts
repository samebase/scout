/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import schema from "./schema";

const hosting = vi.hoisted(() => ({
  register: vi.fn(),
  auth: vi.fn(),
  loadRenderer: vi.fn(),
  render: vi.fn(),
}));
vi.mock("@convex-dev/static-hosting", () => ({ registerStaticRoutes: hosting.register }));
vi.mock("./auth", () => ({ auth: { addHttpRoutes: hosting.auth } }));
vi.mock("../dist/server/server.js", () => ({ default: { fetch: hosting.render } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("HOMEPAGE_SSR_ENABLED", undefined);
  vi.stubEnv("CONVEX_SITE_URL", "https://preview.convex.site");
  vi.doMock("../dist/server/server.js", () => {
    hosting.loadRenderer();
    return { default: { fetch: hosting.render } };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("serves public prerenders with an app fallback and keeps auth routes", async () => {
  const { default: http } = await import("./http");
  const { rewriteStaticPath } = await import("../prerender.config");
  expect(hosting.register).toHaveBeenCalledExactlyOnceWith(http, expect.anything(), {
    spaFallback: true,
    rewritePath: rewriteStaticPath,
  });
  expect(hosting.auth).toHaveBeenCalledExactlyOnceWith(http);
});

test("renders homepage requests through TanStack and disables document caching", async () => {
  vi.stubEnv("HOMEPAGE_SSR_ENABLED", "true");
  hosting.render.mockResolvedValue(
    new Response("<html>Rendered reviews</html>", {
      headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" },
    }),
  );
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  const response = await backend.fetch("/?site=example");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("<html>Rendered reviews</html>");
  expect(hosting.render).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      url: expect.stringContaining("/?site=example"),
    }),
  );
  expect(hosting.loadRenderer).toHaveBeenCalledExactlyOnceWith();
});

test.each([
  { setting: undefined, path: "/", asset: "/_landing.html" },
  { setting: "false", path: "/", asset: "/_landing.html" },
  { setting: "false", path: "/?site=example&scope=public", asset: "/index.html" },
  { setting: "false", path: "/?scope=mine", asset: "/index.html" },
])(
  "serves static HTML without loading the renderer when SSR is $setting at $path",
  async ({ setting, path, asset }) => {
    vi.stubEnv("HOMEPAGE_SSR_ENABLED", setting);
    hosting.loadRenderer.mockImplementation(() => {
      throw new Error("Renderer cannot initialize");
    });
    const fetchStatic = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html>Static Scout homepage</html>", {
        headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" },
      }),
    );
    vi.stubGlobal("fetch", fetchStatic);
    const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
    const response = await backend.fetch(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("<html>Static Scout homepage</html>");
    expect(fetchStatic).toHaveBeenCalledExactlyOnceWith(
      new URL(asset, "https://preview.convex.site"),
    );
    expect(hosting.loadRenderer).not.toHaveBeenCalled();
    expect(hosting.render).not.toHaveBeenCalled();
  },
);

test("disabling SSR recovers after the renderer fails to initialize", async () => {
  vi.stubEnv("HOMEPAGE_SSR_ENABLED", "true");
  hosting.loadRenderer.mockImplementation(() => {
    throw new Error("Renderer cannot initialize");
  });
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  await expect(backend.fetch("/")).rejects.toThrow();
  expect(hosting.loadRenderer).toHaveBeenCalledExactlyOnceWith();
  vi.stubEnv("HOMEPAGE_SSR_ENABLED", "false");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response("Static Scout homepage")),
  );
  const response = await backend.fetch("/");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Static Scout homepage");
  expect(hosting.loadRenderer).toHaveBeenCalledTimes(1);
});

test("preserves static hosting errors while SSR is disabled", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Static assets unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain", "Retry-After": "5" },
      }),
    ),
  );
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  const response = await backend.fetch("/");
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("5");
  expect(await response.text()).toBe("Static assets unavailable");
});
