/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionAddress } from "convex/server";
import { DelayedPromise } from "@ai-sdk/provider-utils";
import firecrawlTest from "@firecrawl/firecrawl-convex/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { components } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { createWebTools } from "./webTools";

const options = { toolCallId: "web-test", messages: [], context: {} };
const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key"));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
});

function crawlPage(url: string, markdown = "# page") {
  return { markdown, metadata: { sourceURL: url, title: url } };
}

async function setupCrawl() {
  vi.useFakeTimers({ toFake: ["Date"] });
  const backend = convexTest(schema, modules);
  firecrawlTest.register(backend);
  const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const requests: Request[] = [];
  const status = vi.fn(async () =>
    Response.json({ success: true, status: "completed", total: 0, completed: 0, data: [] }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "POST" && request.url === "https://api.firecrawl.dev/v2/crawl") {
        return Response.json({ success: true, id: "crawl-1" });
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/v2/crawl/crawl-1") {
        return (await status()).clone();
      }
      throw new Error(`Unexpected Firecrawl request: ${request.method} ${request.url}`);
    }),
  );
  return {
    backend,
    userId,
    requests,
    status,
    start: (
      executeOptions: Parameters<
        NonNullable<ReturnType<typeof createWebTools>["web_crawl"]["execute"]>
      >[1] = options,
    ) =>
      backend.action(async (ctx) =>
        createWebTools(ctx, { userId, threadId: "web-test" }).web_crawl.execute?.(
          { url: "https://example.com", limit: 5, maxDiscoveryDepth: 2 },
          executeOptions,
        ),
      ),
  };
}

describe("Component crawls", { timeout: 10_000 }, () => {
  it("returns every page at the requested limit with provider usage and crawl options", async () => {
    const { start, status, requests } = await setupCrawl();
    const pages = Array.from({ length: 5 }, (_, index) =>
      crawlPage(`https://example.com/${index}`, "a".repeat(4_001)),
    );
    status.mockResolvedValue(
      Response.json({
        success: true,
        status: "completed",
        total: 6,
        completed: 5,
        creditsUsed: 5,
        data: [...pages].reverse(),
      }),
    );

    expect(await start()).toEqual({
      crawlId: "crawl-1",
      status: "completed",
      total: 6,
      completed: 5,
      creditsUsed: 5,
      pages: pages.map((page) => ({
        url: page.metadata.sourceURL,
        title: page.metadata.title,
        text: page.markdown,
      })),
    });
    expect(await requests[0]?.json()).toEqual({
      origin: "firecrawl-convex",
      url: "https://example.com",
      limit: 5,
      maxDiscoveryDepth: 2,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
      },
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer fc-test-key");
  });

  it("waits for the final result cursor after the provider reports completed", async () => {
    const { start, status, requests, backend } = await setupCrawl();
    const secondPage = new DelayedPromise<Response>();
    status
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          status: "completed",
          total: 2,
          completed: 2,
          next: "https://api.firecrawl.dev/v2/crawl/crawl-1?skip=1",
          data: [crawlPage("https://example.com/a")],
        }),
      )
      .mockImplementationOnce(() => secondPage.promise);
    const pending = start();
    const settled = vi.fn();
    void pending.then(settled, settled);
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    expect(
      await backend.query(components.firecrawl.crawl.getByJobId, { jobId: "crawl-1" }),
    ).toMatchObject({ status: "completed", finalized: false, pageCount: 1 });
    expect(settled).not.toHaveBeenCalled();

    secondPage.resolve(
      Response.json({
        success: true,
        status: "completed",
        total: 2,
        completed: 2,
        data: [crawlPage("https://example.com/b")],
      }),
    );
    expect(await pending).toMatchObject({
      pages: [
        { url: "https://example.com/a", text: "# page" },
        { url: "https://example.com/b", text: "# page" },
      ],
    });
    expect(requests[2]?.url).toBe("https://api.firecrawl.dev/v2/crawl/crawl-1?skip=1");
  });

  it.each(["failed", "cancelled"])(
    "reports a %s crawl even with a result cursor",
    async (outcome) => {
      const { start, status } = await setupCrawl();
      status.mockResolvedValue(
        Response.json({
          success: true,
          status: outcome,
          total: 0,
          completed: 0,
          next: "https://api.firecrawl.dev/v2/crawl/crawl-1?skip=0",
          data: [],
        }),
      );
      await expect(start()).rejects.toThrow(`Firecrawl crawl crawl-1 ended with status ${outcome}`);
    },
  );

  it.each([
    {
      name: "truncated text",
      document: crawlPage("https://example.com/large", "a".repeat(500_000)),
      error: "truncated content",
    },
    {
      name: "a skipped page without a URL",
      document: { markdown: "A page with no source URL", metadata: { title: "Missing URL" } },
      error: "incomplete stored results",
    },
    {
      name: "a page the component cannot store",
      document: {
        markdown: "Unstorable metadata",
        metadata: { sourceURL: "https://example.com/invalid", $invalid: true },
      },
      error: "could not store 1 page(s)",
    },
  ])("rejects $name", async ({ document, error }) => {
    const { start, status } = await setupCrawl();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    status.mockResolvedValue(
      Response.json({
        success: true,
        status: "completed",
        total: 1,
        completed: 1,
        data: [document],
      }),
    );
    await expect(start()).rejects.toThrow(error);
  });

  it.each(["abort", "timeout"])(
    "ends the local wait on %s and never returns a later completed result",
    async (end) => {
      const { start, status, backend } = await setupCrawl();
      status.mockResolvedValue(
        Response.json({ success: true, status: "scraping", total: 1, completed: 0, data: [] }),
      );
      const controller = new AbortController();
      const pending = start({ ...options, abortSignal: controller.signal });
      const onSuccess = vi.fn();
      void pending.then(onSuccess, () => undefined);
      await vi.waitFor(() => expect(status).toHaveBeenCalledOnce(), { timeout: 5_000 });
      if (end === "abort") controller.abort();
      else vi.advanceTimersByTime(120_000);

      await expect(pending).rejects.toThrow(
        end === "timeout" ? "timed out after 120 seconds" : /abort/i,
      );
      status.mockResolvedValue(
        Response.json({
          success: true,
          status: "completed",
          total: 1,
          completed: 1,
          data: [crawlPage("https://example.com/late")],
        }),
      );
      await vi.waitFor(
        async () => {
          expect(
            await backend.query(components.firecrawl.crawl.getByJobId, { jobId: "crawl-1" }),
          ).toMatchObject({ status: "completed", finalized: true });
        },
        { timeout: 5_000 },
      );
      await backend.finishInProgressScheduledFunctions();
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it("rejects an abort received while the completed pages query returns", async () => {
    const { backend, userId } = await setupCrawl();
    const controller = new AbortController();
    const pagesReference = getFunctionAddress(components.firecrawl.crawl.listPages).reference;
    const pending = backend.action(async (ctx) => {
      const runQuery = ctx.runQuery.bind(ctx);
      vi.spyOn(ctx, "runQuery").mockImplementation(async (...args: Parameters<typeof runQuery>) => {
        const result = await runQuery(args[0], args[1]);
        if (getFunctionAddress(args[0]).reference === pagesReference) controller.abort();
        return result;
      });
      return createWebTools(ctx, { userId, threadId: "web-test" }).web_crawl.execute?.(
        { url: "https://example.com", limit: 5 },
        { ...options, abortSignal: controller.signal },
      );
    });

    await expect(pending).rejects.toThrow(/abort/i);
    expect(controller.signal.aborted).toBe(true);
  });
});
