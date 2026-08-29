import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { productResearchAgent } from "./productResearchAgent";
import {
  FIRECRAWL_MAP_REQUEST_LIMIT,
  FIRECRAWL_SEARCH_REQUEST_LIMIT,
  FIRECRAWL_SEARCH_FALLBACK_CREDITS,
  MAX_RESEARCH_FIRECRAWL_CREDITS,
  type ProductRetrievalMetadata,
  type ResearchCandidate,
  type ScrapedResearchPage,
  buildProductResearchPrompt,
  createProductRetrievalMetadata,
  hasAdequateResearchCoverage,
  hydrateProductResearchResult,
  parseFirecrawlMapResponse,
  parseFirecrawlScrapeResponse,
  parseFirecrawlSearchResponse,
  parseProductResearchSynthesisText,
  requireUsableResearchPages,
  selectResearchCandidates,
  usableResearchPages,
} from "./productsResearch";
import { boundedInvestigationFailure } from "./productsValidation";
import { fetchJson, requireEnv } from "./scout/lib/http";

const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v2/map";
const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const MAP_TIMEOUT_MS = 15_000;
const SEARCH_TIMEOUT_MS = 15_000;
const SCRAPE_TIMEOUT_MS = 20_000;
const SYNTHESIS_TIMEOUT_MS = 90_000;
const FIRECRAWL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const SYNTHESIS_MAX_OUTPUT_TOKENS = 6_000;

type StartedProductResearch = {
  productDomain: string;
  productName: string;
  primaryUrl: string;
  agentThreadId: string;
  startedAt: number;
};

function providerHeaders() {
  return {
    Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

function searchQuery(productName: string, productDomain: string) {
  return `${productName} ${productDomain} pricing features documentation help security privacy integrations API signup access`;
}

async function activeProductResearch(
  ctx: Pick<ActionCtx, "runQuery">,
  investigationId: Id<"productInvestigations">,
  startedAt: number,
) {
  const active: boolean = await ctx.runQuery(internal.products.isProductResearchActive, {
    investigationId,
    startedAt,
  });
  return active;
}

async function recordRetrieval(
  ctx: Pick<ActionCtx, "runMutation">,
  investigationId: Id<"productInvestigations">,
  startedAt: number,
  retrieval: ProductRetrievalMetadata,
) {
  const recorded: boolean = await ctx.runMutation(
    internal.products.recordProductResearchRetrieval,
    {
      investigationId,
      startedAt,
      retrieval,
    },
  );
  return recorded;
}

async function failProductResearch(
  ctx: Pick<ActionCtx, "runMutation">,
  investigationId: Id<"productInvestigations">,
  failure: unknown,
  retrieval: ProductRetrievalMetadata | undefined,
) {
  await ctx.runMutation(internal.products.failProductResearch, {
    investigationId,
    failure: boundedInvestigationFailure(failure),
    ...(retrieval === undefined ? {} : { retrieval }),
  });
}

async function scrapeCandidate(
  candidate: ResearchCandidate,
  productDomain: string,
  headers: Record<string, string>,
): Promise<ScrapedResearchPage | null> {
  try {
    const response = await fetchJson("Firecrawl", FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      body: JSON.stringify({
        url: candidate.url,
        formats: ["markdown"],
        onlyMainContent: true,
        proxy: "basic",
        maxAge: FIRECRAWL_CACHE_MAX_AGE_MS,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
    });
    return parseFirecrawlScrapeResponse(response, candidate, productDomain);
  } catch {
    return null;
  }
}

async function scrapeCandidates(
  candidates: readonly ResearchCandidate[],
  productDomain: string,
  headers: Record<string, string>,
) {
  const results: (ScrapedResearchPage | null)[] = [];
  for (let index = 0; index < candidates.length; index += 2) {
    const batch = candidates.slice(index, index + 2);
    results.push(
      ...(await Promise.all(
        batch.map(async (candidate) => await scrapeCandidate(candidate, productDomain, headers)),
      )),
    );
  }
  return results;
}

export const run = internalAction({
  args: { investigationId: v.id("productInvestigations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started: StartedProductResearch | null = await ctx.runMutation(
      internal.products.markProductResearchRunning,
      args,
    );
    if (!started) return null;

    let retrieval: ProductRetrievalMetadata | undefined;
    try {
      const headers = providerHeaders();
      const mapResponse = await fetchJson("Firecrawl", FIRECRAWL_MAP_URL, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(MAP_TIMEOUT_MS),
        body: JSON.stringify({
          url: started.primaryUrl,
          sitemap: "include",
          includeSubdomains: true,
          ignoreQueryParameters: true,
          limit: FIRECRAWL_MAP_REQUEST_LIMIT,
          timeout: MAP_TIMEOUT_MS,
        }),
      });
      const mapCandidates = parseFirecrawlMapResponse(mapResponse, started.productDomain);
      retrieval = createProductRetrievalMetadata({
        searchCredits: 0,
        mapCandidateCount: mapCandidates.length,
        selectedPageCount: 0,
        scrapedPageCount: 0,
        scrapeCredits: 0,
      });
      if (
        !(await activeProductResearch(ctx, args.investigationId, started.startedAt)) ||
        !(await recordRetrieval(ctx, args.investigationId, started.startedAt, retrieval))
      ) {
        return null;
      }

      let candidates = selectResearchCandidates(
        mapCandidates,
        started.primaryUrl,
        started.productDomain,
      );
      let searchCredits = 0;
      if (!hasAdequateResearchCoverage(candidates)) {
        try {
          const searchResponse = await fetchJson("Firecrawl", FIRECRAWL_SEARCH_URL, {
            method: "POST",
            headers,
            signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
            body: JSON.stringify({
              query: searchQuery(started.productName, started.productDomain),
              limit: FIRECRAWL_SEARCH_REQUEST_LIMIT,
              sources: ["web"],
              includeDomains: [started.productDomain],
              timeout: SEARCH_TIMEOUT_MS,
              ignoreInvalidURLs: true,
            }),
          });
          const search = parseFirecrawlSearchResponse(searchResponse, started.productDomain);
          searchCredits = search.creditsUsed;
          candidates = selectResearchCandidates(
            [...mapCandidates, ...search.candidates],
            started.primaryUrl,
            started.productDomain,
          );
        } catch {
          searchCredits = FIRECRAWL_SEARCH_FALLBACK_CREDITS;
        }
        if (!(await activeProductResearch(ctx, args.investigationId, started.startedAt))) {
          return null;
        }
      }

      const availableScrapeCredits = MAX_RESEARCH_FIRECRAWL_CREDITS - 1 - searchCredits;
      if (availableScrapeCredits < 1) {
        throw new Error("Firecrawl retrieval left no credits for a first-party page");
      }
      const selected = candidates.slice(0, availableScrapeCredits);
      retrieval = createProductRetrievalMetadata({
        searchCredits,
        mapCandidateCount: mapCandidates.length,
        selectedPageCount: selected.length,
        scrapedPageCount: 0,
        scrapeCredits: 0,
      });
      if (!(await recordRetrieval(ctx, args.investigationId, started.startedAt, retrieval))) {
        return null;
      }

      const scrapeResults = await scrapeCandidates(selected, started.productDomain, headers);
      const usablePages = usableResearchPages(scrapeResults);
      // Firecrawl's basic scrape is one credit per request. Counting every
      // attempted scrape, including an unsuccessful one, is a conservative ceiling.
      retrieval = createProductRetrievalMetadata({
        searchCredits,
        mapCandidateCount: mapCandidates.length,
        selectedPageCount: selected.length,
        scrapedPageCount: usablePages.length,
        scrapeCredits: selected.length,
      });
      if (
        !(await activeProductResearch(ctx, args.investigationId, started.startedAt)) ||
        !(await recordRetrieval(ctx, args.investigationId, started.startedAt, retrieval))
      ) {
        return null;
      }
      requireUsableResearchPages(usablePages);

      const prepared = buildProductResearchPrompt(
        started.productName,
        started.productDomain,
        usablePages,
      );
      const { thread } = await productResearchAgent.continueThread(ctx, {
        threadId: started.agentThreadId,
      });
      const generated = await thread.generateText({
        prompt: prepared.prompt,
        maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
      });
      if (!(await activeProductResearch(ctx, args.investigationId, started.startedAt))) {
        return null;
      }
      const synthesis = parseProductResearchSynthesisText(generated.text);
      const result = hydrateProductResearchResult(synthesis, prepared.pages, started.productDomain);
      await ctx.runMutation(internal.products.completeProductResearch, {
        investigationId: args.investigationId,
        startedAt: started.startedAt,
        retrieval,
        result,
      });
    } catch (error) {
      await failProductResearch(ctx, args.investigationId, error, retrieval);
    }
    return null;
  },
});
