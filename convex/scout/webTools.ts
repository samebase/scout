"use node";

import { tool } from "ai";
import { z } from "zod";
import { createFirecrawlClient } from "./lib/firecrawl";

const MAX_PAGE_CHARACTERS = 20_000;

export function createWebTools() {
  return {
    web_search: tool({
      description:
        "Search the public web with Firecrawl. Returns up to five results with source URLs.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(1_000) }),
      execute: async ({ query }) => {
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
      inputSchema: z.object({
        url: z.url().refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }, "Use an HTTPS URL without embedded credentials"),
      }),
      execute: async ({ url }) => {
        const response = await createFirecrawlClient().scrape(url, {
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: 60_000,
          autoResume: false,
        });
        const text = response.markdown ?? "";
        return {
          url: response.metadata?.sourceURL ?? url,
          title: response.metadata?.title ?? null,
          text: text.slice(0, MAX_PAGE_CHARACTERS),
          truncated: text.length > MAX_PAGE_CHARACTERS,
        };
      },
    }),
  };
}
