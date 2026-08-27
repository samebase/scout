import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { type Infer, v } from "convex/values";

export const scoutModelValidator = v.union(
  v.literal("openai/gpt-5.6-luna"),
  v.literal("qwen/qwen3.8-flash"),
);

export type ScoutModel = Infer<typeof scoutModelValidator>;

export const scoutTokenUsageValidator = v.object({
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
});

export type ScoutTokenUsage = Infer<typeof scoutTokenUsageValidator>;

export const DEFAULT_SCOUT_MODEL: ScoutModel = "openai/gpt-5.6-luna";

export function scoutLanguageModel(model: ScoutModel) {
  return convexGateway(model);
}
