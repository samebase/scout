import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx } from "./_generated/server";
import { productInvestigationWorkflow } from "./productInvestigationWorkflow";
import { productResearchAgent } from "./productResearchAgent";
import {
  PRODUCT_INVESTIGATION_EFFORT,
  PRODUCT_INVESTIGATION_MODEL,
  productInvestigationResultValidator,
  productRetrievalMetadataValidator,
} from "./productsModel";
import {
  FIRECRAWL_MAP_REQUEST_LIMIT,
  FIRECRAWL_SEARCH_FALLBACK_CREDITS,
  FIRECRAWL_SEARCH_REQUEST_LIMIT,
  MAX_RESEARCH_FIRECRAWL_CREDITS,
  type ProductRetrievalMetadata,
  type ResearchCandidate,
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
const SYNTHESIS_MAX_OUTPUT_TOKENS = 16_000;

const researchCandidateValidator = v.object({
  url: v.string(),
  title: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
});

function providerHeaders() {
  return {
    Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

function searchQuery(productName: string, productDomain: string) {
  return `${productName} ${productDomain} pricing features documentation help security privacy integrations API signup access`;
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function requireActive(
  ctx: Pick<ActionCtx, "runQuery">,
  investigationId: Id<"productInvestigations">,
  startedAt: number,
) {
  const active: boolean = await ctx.runQuery(internal.products.isProductResearchActive, {
    investigationId,
    startedAt,
  });
  if (!active) throw new Error("Product investigation is no longer active");
}

async function recordRetrieval(
  ctx: Pick<ActionCtx, "runMutation">,
  investigationId: Id<"productInvestigations">,
  startedAt: number,
  retrieval: ProductRetrievalMetadata,
) {
  const recorded: boolean = await ctx.runMutation(
    internal.products.recordProductResearchRetrieval,
    { investigationId, startedAt, retrieval },
  );
  if (!recorded) throw new Error("Product investigation is no longer active");
}

async function failActivity(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    investigationId: Id<"productInvestigations">;
    investigationStartedAt: number;
    key: string;
    attempt: number;
    failure: unknown;
  },
) {
  const failure = boundedInvestigationFailure(args.failure);
  await ctx.runMutation(internal.productsInvestigationActivities.fail, {
    investigationId: args.investigationId,
    investigationStartedAt: args.investigationStartedAt,
    key: args.key,
    attempt: args.attempt,
    failure,
  });
  return failure;
}

async function recordSelection(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    investigationId: Id<"productInvestigations">;
    investigationStartedAt: number;
    key: string;
    sequence: number;
    candidates: readonly ResearchCandidate[];
    primaryUrl: string;
    productDomain: string;
  },
) {
  const attempt: number | null = await ctx.runMutation(
    internal.productsInvestigationActivities.start,
    {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      key: args.key,
      sequence: args.sequence,
      actor: "Scout",
      operation: "selectResearchCandidates()",
      source: { kind: "local" },
    },
  );
  if (attempt === null) throw new Error("Product investigation is no longer active");
  const selected = selectResearchCandidates(args.candidates, args.primaryUrl, args.productDomain);
  const adequateCoverage = hasAdequateResearchCoverage(selected);
  await ctx.runMutation(internal.productsInvestigationActivities.complete, {
    investigationId: args.investigationId,
    investigationStartedAt: args.investigationStartedAt,
    key: args.key,
    attempt,
    metrics: [
      { label: "Candidates considered", value: String(args.candidates.length) },
      { label: "Pages selected", value: String(selected.length) },
      { label: "Search needed", value: adequateCoverage ? "No" : "Yes" },
      { label: "Selected URLs", value: selected.map((candidate) => candidate.url).join("\n") },
    ],
  });
  return { selected, adequateCoverage };
}

export const discoverSources = internalAction({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    productName: v.string(),
    productDomain: v.string(),
    primaryUrl: v.string(),
  },
  returns: v.object({
    selected: v.array(researchCandidateValidator),
    retrieval: productRetrievalMetadataValidator,
  }),
  handler: async (ctx, args) => {
    const mapBody = {
      url: args.primaryUrl,
      sitemap: "include",
      includeSubdomains: true,
      ignoreQueryParameters: true,
      limit: FIRECRAWL_MAP_REQUEST_LIMIT,
      timeout: MAP_TIMEOUT_MS,
    };
    const mapAttempt: number | null = await ctx.runMutation(
      internal.productsInvestigationActivities.start,
      {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "firecrawl_map",
        sequence: 10,
        actor: "Firecrawl",
        operation: "POST /v2/map",
        source: {
          kind: "external",
          request: { method: "POST", url: FIRECRAWL_MAP_URL, body: prettyJson(mapBody) },
        },
      },
    );
    if (mapAttempt === null) throw new Error("Product investigation is no longer active");

    let mapCandidates: ResearchCandidate[];
    try {
      const mapResponse = await fetchJson("Firecrawl", FIRECRAWL_MAP_URL, {
        method: "POST",
        headers: providerHeaders(),
        signal: AbortSignal.timeout(MAP_TIMEOUT_MS),
        body: JSON.stringify(mapBody),
      });
      mapCandidates = parseFirecrawlMapResponse(mapResponse, args.productDomain);
      await ctx.runMutation(internal.productsInvestigationActivities.complete, {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "firecrawl_map",
        attempt: mapAttempt,
        metrics: [
          { label: "Eligible first-party URLs", value: String(mapCandidates.length) },
          { label: "Firecrawl credits", value: "1" },
        ],
      });
    } catch (error) {
      await failActivity(ctx, {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "firecrawl_map",
        attempt: mapAttempt,
        failure: error,
      });
      throw error;
    }

    let retrieval = createProductRetrievalMetadata({
      searchCredits: 0,
      mapCandidateCount: mapCandidates.length,
      selectedPageCount: 0,
      scrapedPageCount: 0,
      scrapeCredits: 0,
    });
    await recordRetrieval(ctx, args.investigationId, args.investigationStartedAt, retrieval);

    let selection = await recordSelection(ctx, {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      key: "select_sources_after_map",
      sequence: 20,
      candidates: mapCandidates,
      primaryUrl: args.primaryUrl,
      productDomain: args.productDomain,
    });
    let searchCredits = 0;
    const query = searchQuery(args.productName, args.productDomain);
    const searchBody = {
      query,
      limit: FIRECRAWL_SEARCH_REQUEST_LIMIT,
      sources: ["web"],
      includeDomains: [args.productDomain],
      timeout: SEARCH_TIMEOUT_MS,
      ignoreInvalidURLs: true,
    };
    if (selection.adequateCoverage) {
      await ctx.runMutation(internal.productsInvestigationActivities.skip, {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "firecrawl_search",
        sequence: 30,
        actor: "Firecrawl",
        operation: "POST /v2/search",
        source: {
          kind: "external",
          request: { method: "POST", url: FIRECRAWL_SEARCH_URL, body: prettyJson(searchBody) },
        },
        reason: "The site map produced enough first-party source coverage.",
      });
    } else {
      const searchAttempt: number | null = await ctx.runMutation(
        internal.productsInvestigationActivities.start,
        {
          investigationId: args.investigationId,
          investigationStartedAt: args.investigationStartedAt,
          key: "firecrawl_search",
          sequence: 30,
          actor: "Firecrawl",
          operation: "POST /v2/search",
          source: {
            kind: "external",
            request: { method: "POST", url: FIRECRAWL_SEARCH_URL, body: prettyJson(searchBody) },
          },
        },
      );
      if (searchAttempt === null) throw new Error("Product investigation is no longer active");
      try {
        const searchResponse = await fetchJson("Firecrawl", FIRECRAWL_SEARCH_URL, {
          method: "POST",
          headers: providerHeaders(),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
          body: JSON.stringify(searchBody),
        });
        const search = parseFirecrawlSearchResponse(searchResponse, args.productDomain);
        searchCredits = search.creditsUsed;
        await ctx.runMutation(internal.productsInvestigationActivities.complete, {
          investigationId: args.investigationId,
          investigationStartedAt: args.investigationStartedAt,
          key: "firecrawl_search",
          attempt: searchAttempt,
          metrics: [
            { label: "Eligible first-party results", value: String(search.candidates.length) },
            { label: "Firecrawl credits", value: String(searchCredits) },
          ],
        });
        selection = await recordSelection(ctx, {
          investigationId: args.investigationId,
          investigationStartedAt: args.investigationStartedAt,
          key: "select_sources_after_search",
          sequence: 31,
          candidates: [...mapCandidates, ...search.candidates],
          primaryUrl: args.primaryUrl,
          productDomain: args.productDomain,
        });
      } catch (error) {
        searchCredits = FIRECRAWL_SEARCH_FALLBACK_CREDITS;
        await failActivity(ctx, {
          investigationId: args.investigationId,
          investigationStartedAt: args.investigationStartedAt,
          key: "firecrawl_search",
          attempt: searchAttempt,
          failure: error,
        });
      }
    }

    const availableScrapeCredits = MAX_RESEARCH_FIRECRAWL_CREDITS - 1 - searchCredits;
    if (availableScrapeCredits < 1) {
      throw new Error("Firecrawl retrieval left no credits for a first-party page");
    }
    const selected = selection.selected.slice(0, availableScrapeCredits);
    retrieval = createProductRetrievalMetadata({
      searchCredits,
      mapCandidateCount: mapCandidates.length,
      selectedPageCount: selected.length,
      scrapedPageCount: 0,
      scrapeCredits: 0,
    });
    await requireActive(ctx, args.investigationId, args.investigationStartedAt);
    await recordRetrieval(ctx, args.investigationId, args.investigationStartedAt, retrieval);
    return { selected, retrieval };
  },
});

async function scrapeSource(
  ctx: ActionCtx,
  args: {
    investigationId: Id<"productInvestigations">;
    investigationStartedAt: number;
    candidate: ResearchCandidate;
    productDomain: string;
    index: number;
  },
) {
  const body = {
    url: args.candidate.url,
    formats: ["markdown"],
    onlyMainContent: true,
    proxy: "basic",
    maxAge: FIRECRAWL_CACHE_MAX_AGE_MS,
    timeout: SCRAPE_TIMEOUT_MS,
  };
  const key = `firecrawl_scrape_${args.index + 1}`;
  const attempt: number | null = await ctx.runMutation(
    internal.productsInvestigationActivities.start,
    {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      key,
      sequence: 40 + args.index,
      actor: "Firecrawl",
      operation: "POST /v2/scrape",
      source: {
        kind: "external",
        request: { method: "POST", url: FIRECRAWL_SCRAPE_URL, body: prettyJson(body) },
      },
    },
  );
  if (attempt === null) throw new Error("Product investigation is no longer active");
  try {
    const response = await fetchJson("Firecrawl", FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: providerHeaders(),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
    const page = parseFirecrawlScrapeResponse(response, args.candidate, args.productDomain);
    const artifactId: Id<"productInvestigationArtifacts"> | null = await ctx.runMutation(
      internal.productsInvestigationActivities.storeArtifact,
      {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        sequence: args.index,
        url: page.url,
        title: page.title,
        markdown: page.markdown,
      },
    );
    if (artifactId === null) throw new Error("Product investigation is no longer active");
    await ctx.runMutation(internal.productsInvestigationActivities.complete, {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      key,
      attempt,
      metrics: [
        { label: "Source URL", value: page.url },
        { label: "Page title", value: page.title },
        { label: "Markdown characters", value: String(page.markdown.length) },
        { label: "Firecrawl credits", value: "1" },
      ],
    });
    return artifactId;
  } catch (error) {
    await failActivity(ctx, {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      key,
      attempt,
      failure: error,
    });
    return null;
  }
}

export const readSources = internalAction({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    productDomain: v.string(),
    selected: v.array(researchCandidateValidator),
    retrieval: productRetrievalMetadataValidator,
  },
  returns: v.object({
    artifactIds: v.array(v.id("productInvestigationArtifacts")),
    retrieval: productRetrievalMetadataValidator,
  }),
  handler: async (ctx, args) => {
    const existing: {
      artifactId: Id<"productInvestigationArtifacts">;
      sequence: number;
      url: string;
    }[] = await ctx.runQuery(internal.productsInvestigationActivities.listArtifacts, {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
    });
    const existingByUrl = new Map(existing.map((artifact) => [artifact.url, artifact.artifactId]));
    const results: (Id<"productInvestigationArtifacts"> | null)[] = [];
    for (let index = 0; index < args.selected.length; index += 2) {
      const batch = args.selected.slice(index, index + 2);
      results.push(
        ...(await Promise.all(
          batch.map(async (candidate, batchIndex) => {
            const artifactId = existingByUrl.get(candidate.url);
            return (
              artifactId ??
              (await scrapeSource(ctx, {
                investigationId: args.investigationId,
                investigationStartedAt: args.investigationStartedAt,
                candidate,
                productDomain: args.productDomain,
                index: index + batchIndex,
              }))
            );
          }),
        )),
      );
    }
    const artifactIds = results.filter(
      (artifactId): artifactId is Id<"productInvestigationArtifacts"> => artifactId !== null,
    );
    if (artifactIds.length === 0) {
      throw new Error("Firecrawl returned no usable first-party pages");
    }
    const retrieval = createProductRetrievalMetadata({
      searchCredits: args.retrieval.searchCredits,
      mapCandidateCount: args.retrieval.mapCandidateCount,
      selectedPageCount: args.selected.length,
      scrapedPageCount: artifactIds.length,
      scrapeCredits: args.selected.length,
    });
    await requireActive(ctx, args.investigationId, args.investigationStartedAt);
    await recordRetrieval(ctx, args.investigationId, args.investigationStartedAt, retrieval);
    return { artifactIds, retrieval };
  },
});

export const extractClaims = internalAction({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    productName: v.string(),
    productDomain: v.string(),
    agentThreadId: v.string(),
    artifactIds: v.array(v.id("productInvestigationArtifacts")),
  },
  returns: productInvestigationResultValidator,
  handler: async (ctx, args) => {
    const pages = await ctx.runQuery(internal.productsInvestigationActivities.loadArtifacts, {
      investigationId: args.investigationId,
      investigationStartedAt: args.investigationStartedAt,
      artifactIds: args.artifactIds,
    });
    const usablePages = requireUsableResearchPages(pages);
    const prepared = buildProductResearchPrompt(args.productName, args.productDomain, usablePages);
    const request = {
      model: PRODUCT_INVESTIGATION_MODEL,
      effort: PRODUCT_INVESTIGATION_EFFORT,
      sources: prepared.pages.length,
      promptCharacters: prepared.prompt.length,
      maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      temperature: 0,
      timeout: SYNTHESIS_TIMEOUT_MS,
    };
    const attempt: number | null = await ctx.runMutation(
      internal.productsInvestigationActivities.start,
      {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "convex_agent_generate",
        sequence: 80,
        actor: "OpenAI through Convex Agent",
        operation: "generateText()",
        source: {
          kind: "external",
          request: { method: null, url: null, body: prettyJson(request) },
        },
      },
    );
    if (attempt === null) throw new Error("Product investigation is no longer active");
    try {
      const { thread } = await productResearchAgent.continueThread(ctx, {
        threadId: args.agentThreadId,
      });
      const generated = await thread.generateText({
        prompt: prepared.prompt,
        maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
        temperature: 0,
        abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
      });
      await requireActive(ctx, args.investigationId, args.investigationStartedAt);
      const synthesis = parseProductResearchSynthesisText(generated.text);
      const result = hydrateProductResearchResult(synthesis, prepared.pages, args.productDomain);
      await ctx.runMutation(internal.productsInvestigationActivities.complete, {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "convex_agent_generate",
        attempt,
        metrics: [
          { label: "Claims extracted", value: String(result.claims.length) },
          { label: "Tensions found", value: String(result.tensions.length) },
          { label: "Sources cited", value: String(result.sources.length) },
          { label: "Unknowns retained", value: String(result.unknowns.length) },
        ],
      });
      return result;
    } catch (error) {
      await failActivity(ctx, {
        investigationId: args.investigationId,
        investigationStartedAt: args.investigationStartedAt,
        key: "convex_agent_generate",
        attempt,
        failure: error,
      });
      throw error;
    }
  },
});

export const productResearchV1 = productInvestigationWorkflow
  .define({
    args: { investigationId: v.id("productInvestigations") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const started = await step.runMutation(
      internal.products.markProductResearchRunning,
      { investigationId: args.investigationId, durableWorkflow: true },
      { name: "Convex Workflow start investigation" },
    );
    if (started === null) return null;
    const discovered = await step.runAction(
      internal.productsInvestigationWorkflow.discoverSources,
      {
        investigationId: args.investigationId,
        investigationStartedAt: started.startedAt,
        productName: started.productName,
        productDomain: started.productDomain,
        primaryUrl: started.primaryUrl,
      },
      { name: "Scout discover first-party sources", retry: false },
    );
    const read = await step.runAction(
      internal.productsInvestigationWorkflow.readSources,
      {
        investigationId: args.investigationId,
        investigationStartedAt: started.startedAt,
        productDomain: started.productDomain,
        selected: discovered.selected,
        retrieval: discovered.retrieval,
      },
      { name: "Scout read selected sources with Firecrawl", retry: false },
    );
    const result = await step.runAction(
      internal.productsInvestigationWorkflow.extractClaims,
      {
        investigationId: args.investigationId,
        investigationStartedAt: started.startedAt,
        productName: started.productName,
        productDomain: started.productDomain,
        agentThreadId: started.agentThreadId,
        artifactIds: read.artifactIds,
      },
      { name: "Convex Agent extract supported claims", retry: false },
    );
    await step.runMutation(
      internal.products.completeProductResearch,
      {
        investigationId: args.investigationId,
        startedAt: started.startedAt,
        retrieval: read.retrieval,
        result,
      },
      { name: "Convex save investigation report" },
    );
    return null;
  });

export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ investigationId: v.id("productInvestigations") }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.kind === "failed") {
      await ctx.runMutation(internal.products.failProductResearch, {
        investigationId: args.context.investigationId,
        failure: boundedInvestigationFailure(new Error(args.result.error)),
      });
    } else if (args.result.kind === "canceled") {
      await ctx.runMutation(internal.products.failProductResearch, {
        investigationId: args.context.investigationId,
        failure: "Product investigation workflow was canceled",
      });
    }
    return null;
  },
});
