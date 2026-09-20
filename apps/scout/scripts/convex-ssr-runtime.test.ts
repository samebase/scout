import { getNormalizedURL } from "@tanstack/react-router/ssr/server";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: vi.fn(),
  defaultRenderHandler: vi.fn(),
  StartServer: vi.fn(),
}));

const nativeSize = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
if (!nativeSize) throw new Error("This test requires Node's URLSearchParams.size");
afterEach(() => {
  Object.defineProperty(URLSearchParams.prototype, "size", nativeSize);
  vi.resetModules();
});

test("normalizes filtered URLs on Convex's URLSearchParams implementation", async () => {
  Object.defineProperty(URLSearchParams.prototype, "size", {
    configurable: true,
    value: undefined,
  });
  expect(getNormalizedURL("https://example.test/?site=ssr-8").url.pathname).toBe("/site=ssr-8");
  await import("@samebase/convex-tanstack-start/server");
  const normalized = getNormalizedURL("https://example.test/?site=ssr-8&scope=public").url;
  expect(normalized.pathname).toBe("/");
  expect(normalized.searchParams.get("site")).toBe("ssr-8");
  const search = new URLSearchParams("site=one&site=two");
  expect(search.size).toBe(2);
  search.append("scope", "public");
  expect(search.size).toBe(3);
  expect(new URLSearchParams().size).toBe(0);
});

test("preserves native URLSearchParams.size when it is already implemented", async () => {
  await import("@samebase/convex-tanstack-start/server");
  expect(Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size")).toEqual(nativeSize);
});
