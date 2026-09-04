import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { type Infer, v } from "convex/values";
import { omitNullish } from "../../shared/omitNullish";

const lunaModelValidator = v.literal("openai/gpt-5.6-luna");
const qwen37FlashModelValidator = v.literal("qwen/qwen3.7-flash");

export const selectableScoutModelValidator = v.union(lunaModelValidator, qwen37FlashModelValidator);

export type SelectableScoutModel = Infer<typeof selectableScoutModelValidator>;

export const scoutModelValidator = v.union(lunaModelValidator, qwen37FlashModelValidator);

export type ScoutModel = Infer<typeof scoutModelValidator>;

export const scoutTokenUsageValidator = v.object({
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  costUsd: v.optional(v.number()),
});

export type ScoutTokenUsage = Infer<typeof scoutTokenUsageValidator>;

function addOptionalNumbers(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

export function addScoutTokenUsage(
  total: ScoutTokenUsage | undefined,
  next: ScoutTokenUsage,
): ScoutTokenUsage {
  return omitNullish({
    promptTokens: addOptionalNumbers(total?.promptTokens, next.promptTokens),
    completionTokens: addOptionalNumbers(total?.completionTokens, next.completionTokens),
    totalTokens: addOptionalNumbers(total?.totalTokens, next.totalTokens),
    reasoningTokens: addOptionalNumbers(total?.reasoningTokens, next.reasoningTokens),
    cachedInputTokens: addOptionalNumbers(total?.cachedInputTokens, next.cachedInputTokens),
    costUsd: addOptionalNumbers(total?.costUsd, next.costUsd),
  });
}

export const scoutFinishReasonValidator = v.union(
  v.literal("stop"),
  v.literal("length"),
  v.literal("content-filter"),
  v.literal("tool-calls"),
  v.literal("error"),
  v.literal("other"),
);

export const scoutModelCallStateValidator = v.union(
  v.object({ kind: v.literal("pending") }),
  v.object({
    kind: v.literal("completed"),
    finishedAt: v.number(),
    finishReason: scoutFinishReasonValidator,
    usage: scoutTokenUsageValidator,
  }),
  v.object({
    kind: v.literal("failed"),
    failedAt: v.number(),
    failure: v.string(),
  }),
);

const terminalTurnUsageFields = {
  firecrawlCredits: v.optional(v.number()),
  firecrawlDurationMs: v.optional(v.number()),
};

export const scoutTurnStateValidator = v.union(
  v.object({
    kind: v.literal("pending"),
    leaseExpiresAt: v.number(),
    completedSteps: v.number(),
    usage: scoutTokenUsageValidator,
    ...terminalTurnUsageFields,
  }),
  v.object({
    kind: v.literal("completed"),
    completedAt: v.number(),
    usage: scoutTokenUsageValidator,
    ...terminalTurnUsageFields,
  }),
  v.object({
    kind: v.literal("failed"),
    failedAt: v.number(),
    failure: v.string(),
    usage: v.optional(scoutTokenUsageValidator),
    ...terminalTurnUsageFields,
  }),
);

export const DEFAULT_SCOUT_MODEL: SelectableScoutModel = "qwen/qwen3.7-flash";

export function scoutLanguageModel(model: ScoutModel) {
  return convexGateway(model);
}
