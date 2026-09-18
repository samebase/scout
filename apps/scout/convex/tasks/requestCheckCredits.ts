import type { Id } from "../_generated/dataModel";
import { costMicrodollars } from "../creditPolicy";
import { estimateAgentsApiCost } from "./cost";

export const MAX_REQUEST_CHECK_OUTPUT_TOKENS = 1_200;

export function requestCheckCreditSourceKey(checkId: Id<"agentsApiRequestChecks">) {
  return `request_check:${checkId}`;
}

export function maximumRequestCheckCost(model: string, request: string) {
  // Price the request's UTF-8 bytes as uncached input tokens and the full
  // allowed output. This includes instructions and the structured-output schema.
  const inputBytes = new TextEncoder().encode(request).byteLength;
  const maximumUsd = estimateAgentsApiCost({
    model,
    modelUsageIncomplete: false,
    usage: {
      inputTokens: inputBytes,
      outputTokens: MAX_REQUEST_CHECK_OUTPUT_TOKENS,
      cachedInputTokens: 0,
    },
    webSearchCalls: 0,
    browsers: [],
    firecrawlUsdPerCredit: null,
    now: 0,
  }).modelEstimateUsd;
  if (maximumUsd === null) throw new Error("Request check model has no credit price");
  return Math.max(1, costMicrodollars(maximumUsd));
}
