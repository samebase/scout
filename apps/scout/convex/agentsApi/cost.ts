import { type Infer, v } from "convex/values";
import { usage, providerUsage, readUsage } from "../../shared/openaiAgents";

// Standard USD rates verified 2026-09-12. Agents use the model/tool API rates:
// https://developers.openai.com/api/docs/guides/agents-api/overview
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/pricing#built-in-tools
const lunaRates = { input: 0.2, cachedInput: 0.02, output: 1.2 };
const webSearchUsdPerCall = 10 / 1_000;

export const agentsApiUsageValidator = usage;
export type AgentsApiUsage = Infer<typeof agentsApiUsageValidator>;

/**
 * Parse the latest SDK TokenUsage snapshot. Missing cached details remain unknown.
 * Replace saved session usage on each update; never add successive snapshots or add
 * turn usage to session usage. Reasoning tokens already belong to output_tokens.
 * https://developers.openai.com/api/docs/guides/agents-api/observability
 */
export function readAgentsApiUsage(value: unknown): AgentsApiUsage | null {
  return readUsage(providerUsage.parse(value));
}

export const agentsApiBrowserUsageValidator = v.object({
  startedAt: v.number(),
  endedAt: v.union(v.number(), v.null()),
  creditsUsed: v.union(v.number(), v.null()),
});
export type AgentsApiBrowserUsage = Infer<typeof agentsApiBrowserUsageValidator>;

const missingCostInput = v.union(
  v.literal("model_pricing"),
  v.literal("model_usage"),
  v.literal("cached_input_usage"),
  v.literal("web_search_calls"),
  v.literal("browser_credits"),
  v.literal("firecrawl_credit_price"),
);

export const agentsApiCostValidator = v.object({
  modelPricingBasis: v.literal("standard_short_context_excluding_cache_writes"),
  modelEstimateUsd: v.union(v.number(), v.null()),
  webSearchUsd: v.union(v.number(), v.null()),
  browserEstimateUsd: v.union(v.number(), v.null()),
  browserSeconds: v.number(),
  reportedBrowserCredits: v.number(),
  unreportedBrowserSessions: v.number(),
  knownSubtotalUsd: v.number(),
  totalEstimateUsd: v.union(v.number(), v.null()),
  missing: v.array(missingCostInput),
});
export type AgentsApiCost = Infer<typeof agentsApiCostValidator>;

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and nonnegative`);
  }
  return value;
}

/**
 * Estimates the current experiment: one model, environment "none", hosted web
 * search, and Firecrawl browsers. Usage must come from readAgentsApiUsage.
 *
 * Model usage is best effort, not an invoice. Luna's cache-write counts and each
 * individual request's context size are unavailable in session usage. This uses
 * standard short-context rates without cache-write premiums, even when cumulative
 * input exceeds 272K. Do not apply long-context multipliers to session totals.
 *
 * webSearchCalls is a deduplicated count from complete provider history, or null
 * when unknown. Search content and reasoning tokens are already in model usage.
 * All browser timestamps and now are milliseconds. Supply every browser once.
 * Elapsed time includes handoffs; credits come only from the provider close result.
 * Scout has no shared USD/Firecrawl-credit rate: supply the plan rate or null.
 * https://docs.firecrawl.dev/features/browser
 * https://www.firecrawl.dev/pricing
 *
 * knownSubtotalUsd includes only priced components and reported browser credits.
 * totalEstimateUsd is null if any cost input is unknown. Zero means known zero.
 */
export function estimateAgentsApiCost({
  model,
  usage,
  webSearchCalls,
  browsers,
  firecrawlUsdPerCredit,
  now,
}: {
  model: string;
  usage: AgentsApiUsage | null;
  webSearchCalls: number | null;
  browsers: readonly AgentsApiBrowserUsage[];
  firecrawlUsdPerCredit: number | null;
  now: number;
}): AgentsApiCost {
  const missing: Infer<typeof missingCostInput>[] = [];
  let modelEstimateUsd: number | null = null;
  if (model !== "gpt-5.6-luna") missing.push("model_pricing");
  if (usage === null) missing.push("model_usage");
  if (usage !== null && usage.cachedInputTokens == null && usage.inputTokens > 0) {
    missing.push("cached_input_usage");
  }
  if (
    model === "gpt-5.6-luna" &&
    usage !== null &&
    (usage.cachedInputTokens != null || usage.inputTokens === 0)
  ) {
    const cached = usage.cachedInputTokens ?? 0;
    modelEstimateUsd =
      ((usage.inputTokens - cached) * lunaRates.input +
        cached * lunaRates.cachedInput +
        usage.outputTokens * lunaRates.output) /
      1_000_000;
  }

  if (webSearchCalls !== null && !Number.isSafeInteger(webSearchCalls)) {
    throw new Error("Web search calls must be an integer");
  }
  const webSearchUsd =
    webSearchCalls === null
      ? null
      : nonnegative(webSearchCalls, "Web search calls") * webSearchUsdPerCall;
  if (webSearchUsd === null) missing.push("web_search_calls");

  nonnegative(now, "Current time");
  if (firecrawlUsdPerCredit !== null) nonnegative(firecrawlUsdPerCredit, "Firecrawl credit price");
  let browserSeconds = 0;
  let reportedBrowserCredits = 0;
  let unreportedBrowserSessions = 0;
  for (const browser of browsers) {
    nonnegative(browser.startedAt, "Browser start time");
    const end = nonnegative(browser.endedAt ?? now, "Browser end time");
    browserSeconds += nonnegative(end - browser.startedAt, "Browser duration") / 1_000;
    if (browser.creditsUsed === null) {
      unreportedBrowserSessions++;
    } else {
      reportedBrowserCredits += nonnegative(browser.creditsUsed, "Browser credits");
    }
  }
  if (unreportedBrowserSessions > 0) missing.push("browser_credits");
  if (
    firecrawlUsdPerCredit === null &&
    (reportedBrowserCredits > 0 || unreportedBrowserSessions > 0)
  ) {
    missing.push("firecrawl_credit_price");
  }
  const knownBrowserUsd =
    firecrawlUsdPerCredit === null ? 0 : reportedBrowserCredits * firecrawlUsdPerCredit;
  const browserEstimateUsd =
    unreportedBrowserSessions > 0 || (firecrawlUsdPerCredit === null && reportedBrowserCredits > 0)
      ? null
      : knownBrowserUsd;
  const knownSubtotalUsd = (modelEstimateUsd ?? 0) + (webSearchUsd ?? 0) + knownBrowserUsd;
  return {
    modelPricingBasis: "standard_short_context_excluding_cache_writes",
    modelEstimateUsd,
    webSearchUsd,
    browserEstimateUsd,
    browserSeconds,
    reportedBrowserCredits,
    unreportedBrowserSessions,
    knownSubtotalUsd,
    totalEstimateUsd: missing.length === 0 ? knownSubtotalUsd : null,
    missing,
  };
}
