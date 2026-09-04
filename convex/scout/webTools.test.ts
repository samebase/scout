import { describe, expect, it, vi } from "vite-plus/test";
import { createWebTools } from "./webTools";

const firecrawl = vi.hoisted(() => ({ search: vi.fn(), scrape: vi.fn() }));
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
      timeout: 60_000,
      autoResume: false,
    });
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      text: "a".repeat(20_000),
      truncated: true,
    });
  });

  it("does not report a provider failure as an empty successful page", async () => {
    firecrawl.scrape.mockRejectedValue(new Error("Page unavailable"));
    await expect(
      createWebTools().web_read.execute?.({ url: "https://example.com" }, options),
    ).rejects.toThrow("Page unavailable");
  });
});
