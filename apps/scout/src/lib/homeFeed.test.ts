import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { loadHomeFeed } from "./homeFeed";

const queryRequest = z.object({ path: z.string(), args: z.array(z.unknown()) });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("loads bounded public site and review data through the real HTTP client", async () => {
  vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("TSS_PRERENDERING", "false");
  const requests: z.infer<typeof queryRequest>[] = [];
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init: RequestInit) => {
    const request = queryRequest.parse(JSON.parse(z.string().parse(init.body)));
    requests.push(request);
    switch (request.path) {
      case "scout/sites:list":
        return Promise.resolve(
          Response.json({
            status: "success",
            value: {
              page: [
                {
                  hostname: "example.com",
                  taskCount: 1,
                  preview: null,
                  profile: null,
                  research: null,
                },
              ],
              isDone: true,
              continueCursor: "",
            },
          }),
        );
      case "scout/sites:count":
        return Promise.resolve(
          Response.json({ status: "success", value: { count: 1, hasMore: false } }),
        );
      case "scout/activity:list":
        return Promise.resolve(
          Response.json({
            status: "success",
            value: { page: [], isDone: true, continueCursor: "" },
          }),
        );
      default:
        throw new Error(`Unexpected query: ${request.path}`);
    }
  });
  const feed = await loadHomeFeed({ site: "example", scope: "public" });
  expect(feed?.groups[0].site.hostname).toBe("example.com");
  expect(feed?.count).toEqual({ count: 1, hasMore: false });
  expect(requests).toEqual([
    {
      path: "scout/sites:list",
      args: [{ site: "example", scope: "public", paginationOpts: { numItems: 6, cursor: null } }],
    },
    { path: "scout/sites:count", args: [{ scope: "public" }] },
    {
      path: "scout/activity:list",
      args: [
        { site: "example.com", scope: "public", paginationOpts: { numItems: 2, cursor: null } },
      ],
    },
  ]);
});

test("does not fetch private data or contact a backend during build-time prerendering", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await loadHomeFeed({ site: null, scope: "mine" })).toBeNull();
  vi.stubEnv("TSS_PRERENDERING", "true");
  expect(await loadHomeFeed({ site: null, scope: "public" })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("surfaces a query failure instead of rendering an empty feed", async () => {
  vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("TSS_PRERENDERING", "false");
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("SSR query failed", { status: 500 })));
  await expect(loadHomeFeed({ site: null, scope: "public" })).rejects.toThrow("SSR query failed");
});
