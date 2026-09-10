import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { type Infer, v } from "convex/values";
import { omitNullish } from "../../shared/omitNullish";
import { SCOUT_REASONING_EFFORTS } from "../../shared/scoutReasoning";

const lunaModelValidator = v.literal("openai/gpt-5.6-luna");
const qwen37FlashModelValidator = v.literal("qwen/qwen3.7-flash");
const deepSeekV4FlashModelValidator = v.literal("deepseek/deepseek-v4-flash-0731");

export const selectableScoutModelValidator = v.union(
  lunaModelValidator,
  qwen37FlashModelValidator,
  deepSeekV4FlashModelValidator,
);

export type SelectableScoutModel = Infer<typeof selectableScoutModelValidator>;

export const scoutModelValidator = v.union(
  lunaModelValidator,
  qwen37FlashModelValidator,
  deepSeekV4FlashModelValidator,
);

export type ScoutModel = Infer<typeof scoutModelValidator>;

export const scoutReasoningEffortValidator = v.union(
  ...SCOUT_REASONING_EFFORTS.map((effort) => v.literal(effort)),
);

export const scoutModelSelectionValidator = v.union(
  v.object({
    model: lunaModelValidator,
    reasoningEffort: v.optional(scoutReasoningEffortValidator),
  }),
  v.object({ model: v.union(qwen37FlashModelValidator, deepSeekV4FlashModelValidator) }),
);

export type ScoutModelSelection = Infer<typeof scoutModelSelectionValidator>;

export const scoutPromptValidator = v.union(
  scoutModelSelectionValidator.members[0].extend({ prompt: v.string() }),
  scoutModelSelectionValidator.members[1].extend({ prompt: v.string() }),
);

export function scoutModelSelection(selection: ScoutModelSelection): ScoutModelSelection {
  switch (selection.model) {
    case "openai/gpt-5.6-luna":
      return {
        model: selection.model,
        ...omitNullish({ reasoningEffort: selection.reasoningEffort }),
      };
    case "qwen/qwen3.7-flash":
    case "deepseek/deepseek-v4-flash-0731":
      return { model: selection.model };
  }
}

export const scoutTokenUsageValidator = v.object({
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  costUsd: v.optional(v.number()),
});

export type ScoutTokenUsage = Infer<typeof scoutTokenUsageValidator>;

export const modelCallPurposeValidator = v.union(
  v.object({
    kind: v.literal("generation"),
    compactionId: v.union(v.id("scoutCompactions"), v.null()),
  }),
  v.object({ kind: v.literal("compaction") }),
);

export const compactionFields = {
  threadId: v.string(),
  modelCallId: v.id("scoutModelCalls"),
  previousCompactionId: v.union(v.id("scoutCompactions"), v.null()),
  summary: v.string(),
  coveredThrough: v.object({ messageId: v.string(), order: v.number(), stepOrder: v.number() }),
  coveredMessageCount: v.number(),
  beforeTokens: v.number(),
  afterTokens: v.number(),
};

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
    kind: v.literal("stopping"),
    stopRequestedAt: v.number(),
    generationFinished: v.boolean(),
    cleanupFailure: v.optional(v.string()),
    replacement: v.optional(scoutPromptValidator),
    usage: scoutTokenUsageValidator,
    ...terminalTurnUsageFields,
  }),
  v.object({
    kind: v.literal("replacing"),
    stoppedAt: v.number(),
    replacement: scoutPromptValidator,
    usage: scoutTokenUsageValidator,
    ...terminalTurnUsageFields,
  }),
  v.object({
    kind: v.literal("stopped"),
    stoppedAt: v.number(),
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

export const DEFAULT_SCOUT_MODEL = "qwen/qwen3.7-flash" satisfies SelectableScoutModel;

export function scoutLanguageModel(model: ScoutModel) {
  return convexGateway(model);
}
