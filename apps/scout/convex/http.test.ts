/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vite-plus/test";
import schema from "./schema";

const hosting = vi.hoisted(() => ({ register: vi.fn(), auth: vi.fn(), render: vi.fn() }));
vi.mock("@convex-dev/static-hosting", () => ({ registerStaticRoutes: hosting.register }));
vi.mock("./auth", () => ({ auth: { addHttpRoutes: hosting.auth } }));
vi.mock("../dist/server/server.js", () => ({ default: { fetch: hosting.render } }));
import http from "./http";
import { rewritePrerenderPath } from "../prerender.config";

test("serves public prerenders with an app fallback and keeps auth routes", () => {
  expect(hosting.register).toHaveBeenCalledExactlyOnceWith(http, expect.anything(), {
    spaFallback: true,
    rewritePath: rewritePrerenderPath,
  });
  expect(hosting.auth).toHaveBeenCalledExactlyOnceWith(http);
});

test("renders homepage requests through TanStack and disables document caching", async () => {
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
});
