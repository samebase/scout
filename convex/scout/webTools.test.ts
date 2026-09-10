/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import firecrawlTest from "@firecrawl/firecrawl-convex/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { createWebTools } from "./webTools";

const firecrawl = vi.hoisted(() => ({
  crawl: vi.fn(),
}));
vi.mock("./lib/firecrawl", () => ({ createFirecrawlClient: () => firecrawl }));
const options = { toolCallId: "web-test", messages: [], context: {} };
const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFirecrawl(body: unknown, status = 200) {
  const requests: Request[] = [];
  const request = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", request);
  return { request, requests };
}

async function runTool<T>(execute: (tools: ReturnType<typeof createWebTools>) => Promise<T>) {
  const backend = convexTest(schema, modules);
  firecrawlTest.register(backend);
  const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  return backend.action((ctx) => execute(createWebTools(ctx, { userId, threadId: "web-test" })));
}

describe("Public web tools", () => {
  it("searches through the component and retains source URLs and provider fields", async () => {
    const results = [
      { url: "https://example.com/docs", title: "Docs", description: "A page", position: 1 },
    ];
    const { requests } = mockFirecrawl({ success: true, data: { web: results } });
    const result = await runTool(async (tools) =>
      tools.web_search.execute?.({ query: "example docs" }, options),
    );
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/search");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer fc-test-key");
    expect(await requests[0]?.json()).toEqual({
      origin: "firecrawl-convex",
      query: "example docs",
      sources: ["web"],
      limit: 5,
    });
    expect(result).toEqual({ results });
  });

  it("maps a bounded number of public pages", async () => {
    const { requests } = mockFirecrawl({
      success: true,
      id: "map-1",
      links: [
        {
          url: "https://example.com/docs",
          title: "Docs",
          description: undefined,
          position: undefined,
        },
      ],
    });
    const result = await runTool(async (tools) =>
      tools.web_map.execute?.({ url: "https://example.com", limit: 25 }, options),
    );
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/map");
    expect(await requests[0]?.json()).toEqual({
      origin: "firecrawl-convex",
      url: "https://example.com",
      sitemap: "include",
      limit: 25,
      timeout: 60_000,
    });
    expect(result).toEqual({
      mapId: "map-1",
      count: 1,
      links: [{ url: "https://example.com/docs", title: "Docs" }],
    });
  });

  it("preserves empty search and map results", async () => {
    mockFirecrawl({ success: true, data: { web: [] }, links: [] });
    expect(
      await runTool(async (tools) => tools.web_search.execute?.({ query: "no matches" }, options)),
    ).toEqual({ results: [] });
    expect(
      await runTool(async (tools) =>
        tools.web_map.execute?.({ url: "https://example.com", limit: 25 }, options),
      ),
    ).toEqual({ mapId: null, count: 0, links: [] });
  });

  it("passes the requested map search and limit", async () => {
    const { requests } = mockFirecrawl({ success: true, links: [] });
    await runTool(async (tools) =>
      tools.web_map.execute?.(
        { url: "https://example.com", search: "billing", limit: 50 },
        options,
      ),
    );
    expect(await requests[0]?.json()).toMatchObject({ search: "billing", limit: 50 });
  });

  it("reports component API errors without inventing a successful result", async () => {
    const { request } = mockFirecrawl({ success: false, error: "Insufficient credits" }, 402);
    await expect(
      runTool(async (tools) => tools.web_search.execute?.({ query: "example" }, options)),
    ).rejects.toThrow("Insufficient credits");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid provider URLs in search and map results", async () => {
    mockFirecrawl({ success: true, data: { web: [{ url: 42 }] }, links: [{ url: 42 }] });
    await expect(
      runTool(async (tools) => tools.web_search.execute?.({ query: "example" }, options)),
    ).rejects.toThrow();
    await expect(
      runTool(async (tools) =>
        tools.web_map.execute?.({ url: "https://example.com", limit: 25 }, options),
      ),
    ).rejects.toThrow();
  });

  it("checks dispatch authorization before calling the component", async () => {
    const backend = convexTest(schema, modules);
    firecrawlTest.register(backend);
    const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
    const { request } = mockFirecrawl({ success: true, data: { web: [] } });
    const denied = new Error("Dispatch denied");
    await expect(
      backend.action(async (ctx) =>
        createWebTools(ctx, { userId, threadId: "web-test" }, async () => {
          throw denied;
        }).web_search.execute?.({ query: "example" }, options),
      ),
    ).rejects.toThrow("Dispatch denied");
    expect(request).not.toHaveBeenCalled();
  });

  it("retains complete crawl pages with provider usage", async () => {
    firecrawl.crawl.mockResolvedValue({
      id: "crawl-1",
      status: "completed",
      total: 2,
      completed: 2,
      creditsUsed: 2,
      data: [
        {
          markdown: "a".repeat(4_001),
          metadata: { sourceURL: "https://example.com/docs", title: "Docs" },
        },
      ],
    });
    const result = await runTool(async (tools) =>
      tools.web_crawl.execute?.({ url: "https://example.com", limit: 5 }, options),
    );
    expect(firecrawl.crawl).toHaveBeenCalledWith("https://example.com", {
      limit: 5,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
      },
      pollInterval: 2,
      timeout: 120,
    });
    expect(result).toEqual({
      crawlId: "crawl-1",
      status: "completed",
      total: 2,
      completed: 2,
      creditsUsed: 2,
      pages: [
        {
          url: "https://example.com/docs",
          title: "Docs",
          text: "a".repeat(4_001),
        },
      ],
    });
  });

  it("reports a non-completed crawl as a failure", async () => {
    firecrawl.crawl.mockResolvedValue({
      id: "crawl-1",
      status: "failed",
      total: 0,
      completed: 0,
      data: [],
    });
    await expect(
      runTool(async (tools) =>
        tools.web_crawl.execute?.({ url: "https://example.com", limit: 5 }, options),
      ),
    ).rejects.toThrow("Firecrawl crawl crawl-1 ended with status failed");
  });
});
