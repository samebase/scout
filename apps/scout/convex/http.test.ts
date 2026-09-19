import { expect, test, vi } from "vite-plus/test";

const hosting = vi.hoisted(() => ({ register: vi.fn(), auth: vi.fn() }));
vi.mock("@convex-dev/static-hosting", () => ({ registerStaticRoutes: hosting.register }));
vi.mock("./auth", () => ({ auth: { addHttpRoutes: hosting.auth } }));
import http from "./http";
import { rewritePrerenderPath } from "../prerender.config";

test("serves public prerenders with an app fallback and keeps auth routes", () => {
  expect(hosting.register).toHaveBeenCalledExactlyOnceWith(http, expect.anything(), {
    spaFallback: true,
    rewritePath: rewritePrerenderPath,
  });
  expect(hosting.auth).toHaveBeenCalledExactlyOnceWith(http);
});
