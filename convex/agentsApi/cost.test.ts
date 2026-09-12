import type { TokenUsage } from "openai/resources/beta/agents/agents";
import { describe, expect, it } from "vitest";
import { estimateAgentsApiCost, readAgentsApiUsage } from "./cost";

const providerUsage = {
  input_tokens: 100_000,
  input_tokens_details: { cached_tokens: 80_000 },
  output_tokens: 10_000,
  output_tokens_details: { reasoning_tokens: 8_000 },
  total_tokens: 110_000,
} satisfies TokenUsage;

const base = {
  model: "gpt-5.6-luna",
  usage: readAgentsApiUsage(providerUsage),
  webSearchCalls: 3,
  browsers: [{ startedAt: 1_000, endedAt: 61_500, creditsUsed: 2.5 }],
  firecrawlUsdPerCredit: 0.01,
  now: 120_000,
} satisfies Parameters<typeof estimateAgentsApiCost>[0];

describe("Agents API usage", () => {
  it("keeps SDK cache reads as a subset of input and reasoning within output", () => {
    expect(readAgentsApiUsage(providerUsage)).toEqual({
      inputTokens: 100_000,
      cachedInputTokens: 80_000,
      outputTokens: 10_000,
    });
  });

  it("preserves absent usage and cache details as unknown", () => {
    expect(readAgentsApiUsage(null)).toBeNull();
    for (const details of [undefined, null, {}, { cached_tokens: null }]) {
      expect(
        readAgentsApiUsage({ input_tokens: 20, output_tokens: 3, input_tokens_details: details }),
      ).toEqual({ inputTokens: 20, outputTokens: 3, cachedInputTokens: null });
    }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"])(
    "rejects invalid provider token counts: %s",
    (input_tokens) => {
      expect(() => readAgentsApiUsage({ ...providerUsage, input_tokens })).toThrow();
    },
  );

  it("rejects impossible cache usage and malformed present details", () => {
    expect(() =>
      readAgentsApiUsage({ ...providerUsage, input_tokens_details: { cached_tokens: 100_001 } }),
    ).toThrow("Cached input tokens cannot exceed input tokens");
    expect(() =>
      readAgentsApiUsage({ ...providerUsage, input_tokens_details: "unknown" }),
    ).toThrow();
  });
});

describe("Agents API cost estimates", () => {
  it("prices cache reads once, includes reasoning once, and adds search and browser costs", () => {
    const cost = estimateAgentsApiCost(base);
    expect(cost.modelEstimateUsd).toBeCloseTo(0.0176);
    expect(cost.webSearchUsd).toBeCloseTo(0.03);
    expect(cost.browserEstimateUsd).toBeCloseTo(0.025);
    expect(cost.totalEstimateUsd).toBeCloseTo(0.0726);
    expect(cost.knownSubtotalUsd).toBe(cost.totalEstimateUsd);
    expect(cost.browserSeconds).toBe(60.5);
    expect(cost.missing).toEqual([]);
    expect(cost.modelPricingBasis).toBe("standard_short_context_excluding_cache_writes");
  });

  it("recalculates each cumulative snapshot without accumulating polls or applying a context surcharge", () => {
    const snapshot = {
      ...base,
      usage: readAgentsApiUsage({
        input_tokens: 1_000_000,
        input_tokens_details: { cached_tokens: 800_000 },
        output_tokens: 100_000,
      }),
    };
    expect(estimateAgentsApiCost(snapshot).modelEstimateUsd).toBeCloseTo(0.176);
    expect(estimateAgentsApiCost(base).modelEstimateUsd).toBeCloseTo(0.0176);
  });

  it("preserves known costs when model usage or its price is unavailable", () => {
    for (const input of [
      { ...base, usage: null },
      { ...base, model: "unpriced-model" },
    ]) {
      const cost = estimateAgentsApiCost(input);
      expect(cost.modelEstimateUsd).toBeNull();
      expect(cost.totalEstimateUsd).toBeNull();
      expect(cost.knownSubtotalUsd).toBeCloseTo(0.055);
    }
    expect(estimateAgentsApiCost({ ...base, model: "unpriced-model" }).missing).toEqual([
      "model_pricing",
    ]);
  });

  it("does not price unknown cache reads as zero cache hits", () => {
    const cost = estimateAgentsApiCost({
      ...base,
      usage: readAgentsApiUsage({ input_tokens: 100_000, output_tokens: 10_000 }),
    });
    expect(cost.modelEstimateUsd).toBeNull();
    expect(cost.totalEstimateUsd).toBeNull();
    expect(cost.missing).toEqual(["cached_input_usage"]);
  });

  it("distinguishes known zero costs from missing usage, counts, and rates", () => {
    const cost = estimateAgentsApiCost({
      ...base,
      usage: readAgentsApiUsage({ input_tokens: 0, output_tokens: 0 }),
      webSearchCalls: 0,
      browsers: [],
      firecrawlUsdPerCredit: null,
    });
    expect(cost.totalEstimateUsd).toBe(0);
    expect(cost.missing).toEqual([]);
    const unknown = estimateAgentsApiCost({ ...base, webSearchCalls: null });
    expect(unknown.webSearchUsd).toBeNull();
    expect(unknown.totalEstimateUsd).toBeNull();
    expect(unknown.missing).toEqual(["web_search_calls"]);
  });

  it("measures closed and live browser lifetimes while retaining unreported charges", () => {
    const cost = estimateAgentsApiCost({
      ...base,
      browsers: [...base.browsers, { startedAt: 62_000, endedAt: null, creditsUsed: null }],
    });
    expect(cost.browserSeconds).toBe(118.5);
    expect(cost.reportedBrowserCredits).toBe(2.5);
    expect(cost.unreportedBrowserSessions).toBe(1);
    expect(cost.browserEstimateUsd).toBeNull();
    expect(cost.totalEstimateUsd).toBeNull();
    expect(cost.knownSubtotalUsd).toBeCloseTo(0.0726);
    expect(cost.missing).toEqual(["browser_credits"]);
  });

  it("does not infer Firecrawl credits from duration or a USD price from credits", () => {
    const cost = estimateAgentsApiCost({ ...base, firecrawlUsdPerCredit: null });
    expect(cost.reportedBrowserCredits).toBe(2.5);
    expect(cost.browserEstimateUsd).toBeNull();
    expect(cost.totalEstimateUsd).toBeNull();
    expect(cost.knownSubtotalUsd).toBeCloseTo(0.0476);
    expect(cost.missing).toEqual(["firecrawl_credit_price"]);
    const noCredits = estimateAgentsApiCost({
      ...base,
      browsers: [{ startedAt: 1_000, endedAt: 61_500, creditsUsed: null }],
    });
    expect(noCredits.browserEstimateUsd).toBeNull();
    expect(noCredits.missing).toEqual(["browser_credits"]);
  });

  it("honors provider-reported zero credits and an explicitly supplied zero price", () => {
    expect(
      estimateAgentsApiCost({
        ...base,
        browsers: [{ startedAt: 0, endedAt: 60_000, creditsUsed: 0 }],
        firecrawlUsdPerCredit: null,
      }).browserEstimateUsd,
    ).toBe(0);
    expect(estimateAgentsApiCost({ ...base, firecrawlUsdPerCredit: 0 }).browserEstimateUsd).toBe(0);
  });

  it("rejects invalid external counts, prices, and browser lifecycle data", () => {
    expect(() => estimateAgentsApiCost({ ...base, webSearchCalls: 0.5 })).toThrow();
    expect(() => estimateAgentsApiCost({ ...base, webSearchCalls: -1 })).toThrow();
    expect(() => estimateAgentsApiCost({ ...base, firecrawlUsdPerCredit: NaN })).toThrow();
    expect(() => estimateAgentsApiCost({ ...base, firecrawlUsdPerCredit: -1 })).toThrow();
    expect(() =>
      estimateAgentsApiCost({
        ...base,
        browsers: [{ startedAt: 2_000, endedAt: 1_000, creditsUsed: null }],
      }),
    ).toThrow("Browser duration");
    expect(() =>
      estimateAgentsApiCost({
        ...base,
        browsers: [{ startedAt: 0, endedAt: 1_000, creditsUsed: Infinity }],
      }),
    ).toThrow("Browser credits");
  });
});
