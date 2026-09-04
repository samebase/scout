"use node";

import { tool } from "ai";
import type { CrawlOptions, MapOptions, ScrapeOptions } from "firecrawl";
import { z } from "zod";
import { omitNullish } from "../../shared/omitNullish";
import { createFirecrawlClient } from "./lib/firecrawl";

const MAX_PAGE_CHARACTERS = 20_000;
const DEFAULT_MAP_LIMIT = 25;
const MAX_MAP_LIMIT = 50;
const DEFAULT_CRAWL_LIMIT = 5;
const MAX_CRAWL_LIMIT = 10;
const MAX_CRAWL_PAGE_CHARACTERS = 4_000;

const publicHttpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use an HTTPS URL without embedded credentials");

export function createWebTools(beforeDispatch?: () => Promise<void>) {
  return {
    web_search: tool({
      description:
        "Search the public web with Firecrawl. Returns up to five results with source URLs.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(1_000) }),
      execute: async ({ query }) => {
        await beforeDispatch?.();
        const response = await createFirecrawlClient().search(query, {
          sources: ["web"],
          limit: 5,
        });
        return { results: response.web ?? [] };
      },
    }),
    web_read: tool({
      description:
        "Read a public web page as text with Firecrawl, without opening a browser session. Returns its source URL and whether the text was truncated. Use the browser for signed-in pages or interactions.",
      inputSchema: z.object({ url: publicHttpsUrlSchema }),
      execute: async ({ url }) => {
        await beforeDispatch?.();
        const response = await createFirecrawlClient().scrape(url, {
          formats: ["markdown"],
          onlyMainContent: true,
          removeBase64Images: true,
          timeout: 60_000,
          autoResume: false,
        });
        const text = response.markdown ?? "";
        return {
          url: response.metadata?.sourceURL ?? url,
          title: response.metadata?.title ?? null,
          text: text.slice(0, MAX_PAGE_CHARACTERS),
          truncated: text.length > MAX_PAGE_CHARACTERS,
          creditsUsed: response.metadata?.creditsUsed ?? null,
        };
      },
    }),
    web_map: tool({
      description:
        "Discover public pages on a website with Firecrawl Map. Use this to find relevant URLs before reading specific pages or crawling a section.",
      inputSchema: z.object({
        url: publicHttpsUrlSchema,
        search: z.string().trim().min(1).max(500).optional(),
        limit: z.number().int().min(1).max(MAX_MAP_LIMIT).default(DEFAULT_MAP_LIMIT),
      }),
      execute: async ({ url, search, limit }) => {
        await beforeDispatch?.();
        const mapOptions: MapOptions = {
          sitemap: "include",
          limit,
          timeout: 60_000,
          ...omitNullish({ search }),
        };
        const response = await createFirecrawlClient().map(url, mapOptions);
        return {
          mapId: response.id ?? null,
          count: response.links.length,
          links: response.links.map((link) =>
            omitNullish({
              url: link.url,
              title: link.title,
              description: link.description,
            }),
          ),
        };
      },
    }),
    web_crawl: tool({
      description:
        "Crawl a public website with Firecrawl and return text from several pages. Use this for multi-page research; use web_read when one known page is enough.",
      inputSchema: z.object({
        url: publicHttpsUrlSchema,
        limit: z.number().int().min(1).max(MAX_CRAWL_LIMIT).default(DEFAULT_CRAWL_LIMIT),
        maxDiscoveryDepth: z.number().int().min(0).max(5).optional(),
      }),
      execute: async ({ url, limit, maxDiscoveryDepth }) => {
        await beforeDispatch?.();
        const scrapeOptions: ScrapeOptions = {
          formats: ["markdown"],
          onlyMainContent: true,
          removeBase64Images: true,
        };
        const crawlOptions: CrawlOptions & { pollInterval: number; timeout: number } = {
          limit,
          scrapeOptions,
          pollInterval: 2,
          timeout: 120,
          ...omitNullish({ maxDiscoveryDepth }),
        };
        const response = await createFirecrawlClient().crawl(url, crawlOptions);
        if (response.status !== "completed") {
          throw new Error(`Firecrawl crawl ${response.id} ended with status ${response.status}`);
        }
        return {
          crawlId: response.id,
          status: response.status,
          total: response.total,
          completed: response.completed,
          creditsUsed: response.creditsUsed ?? null,
          pages: response.data.map((document) => {
            const text = document.markdown ?? "";
            return {
              url: document.metadata?.sourceURL ?? document.metadata?.url ?? url,
              title: document.metadata?.title ?? null,
              text: text.slice(0, MAX_CRAWL_PAGE_CHARACTERS),
              truncated: text.length > MAX_CRAWL_PAGE_CHARACTERS,
            };
          }),
        };
      },
    }),
  };
}
