import { describe, expect, it, vi } from "vite-plus/test";
import { createWebTools } from "./webTools";

const firecrawl = vi.hoisted(() => ({
  search: vi.fn(),
  scrape: vi.fn(),
  map: vi.fn(),
  crawl: vi.fn(),
}));
vi.mock("./lib/firecrawl", () => ({ createFirecrawlClient: () => firecrawl }));
const options = { toolCallId: "web-test", messages: [], context: {} };

describe("Public web tools", () => {
  it("uses the SDK search and retains source URLs", async () => {
    const results = [{ url: "https://example.com/docs", title: "Docs", description: "A page" }];
    firecrawl.search.mockResolvedValue({ web: results });
    const result = await createWebTools().web_search.execute?.({ query: "example docs" }, options);
    expect(firecrawl.search).toHaveBeenCalledWith("example docs", { sources: ["web"], limit: 5 });
    expect(result).toEqual({ results });
  });

  it("returns page text with its source and an explicit truncation flag", async () => {
    firecrawl.scrape.mockResolvedValue({
      markdown: "a".repeat(20_001),
      metadata: { title: "Example" },
    });
    const result = await createWebTools().web_read.execute?.(
      { url: "https://example.com" },
      options,
    );
    expect(firecrawl.scrape).toHaveBeenCalledWith("https://example.com", {
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      timeout: 60_000,
      autoResume: false,
    });
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      text: "a".repeat(20_000),
      truncated: true,
      creditsUsed: null,
    });
  });

  it("maps a bounded number of public pages", async () => {
    firecrawl.map.mockResolvedValue({
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
    const result = await createWebTools().web_map.execute?.(
      { url: "https://example.com", limit: 25 },
      options,
    );
    expect(firecrawl.map).toHaveBeenCalledWith("https://example.com", {
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

  it("returns bounded crawl pages with provider usage", async () => {
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
    const result = await createWebTools().web_crawl.execute?.(
      { url: "https://example.com", limit: 5 },
      options,
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
          text: "a".repeat(4_000),
          truncated: true,
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
      createWebTools().web_crawl.execute?.({ url: "https://example.com", limit: 5 }, options),
    ).rejects.toThrow("Firecrawl crawl crawl-1 ended with status failed");
  });

  it("does not report a provider failure as an empty successful page", async () => {
    firecrawl.scrape.mockRejectedValue(new Error("Page unavailable"));
    await expect(
      createWebTools().web_read.execute?.({ url: "https://example.com" }, options),
    ).rejects.toThrow("Page unavailable");
  });
});
