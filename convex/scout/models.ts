import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { type Infer, v } from "convex/values";

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

const terminalTurnUsageFields = {
  firecrawlCredits: v.optional(v.number()),
  firecrawlDurationMs: v.optional(v.number()),
};

export const scoutTurnStateValidator = v.union(
  v.object({
    kind: v.literal("pending"),
    leaseExpiresAt: v.number(),
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
