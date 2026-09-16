import { v } from "convex/values";
import { z } from "zod";

export const item = v.object({
  providerItemId: v.string(),
  kind: v.string(),
  text: v.string(),
  details: v.string(),
  complete: v.optional(v.boolean()),
});

export const usage = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cachedInputTokens: v.optional(v.union(v.number(), v.null())),
});

export const toolCall = v.object({
  callId: v.string(),
  turnId: v.string(),
  name: v.string(),
  argumentsJson: v.string(),
});

export const toolResult = v.union(
  v.object({ kind: v.literal("success"), output: v.string() }),
  v.object({ kind: v.literal("error"), error: v.string() }),
);

export const event = v.union(
  v.object({ kind: v.literal("created"), providerId: v.string() }),
  v.object({ kind: v.literal("item"), item, sequence: v.number() }),
  v.object({ kind: v.literal("tool"), call: toolCall }),
  v.object({
    kind: v.literal("state"),
    state: v.union(
      v.object({ kind: v.literal("running") }),
      v.object({ kind: v.literal("idle") }),
      v.object({ kind: v.literal("stopped") }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
    ),
    usage: v.union(usage, v.null()),
  }),
);

export const notification = v.object({ sessionKey: v.string(), runKey: v.string(), event });

const tokenCount = z.int().nonnegative();
export const providerUsage = z
  .object({
    input_tokens: tokenCount,
    output_tokens: tokenCount,
    input_tokens_details: z.object({ cached_tokens: tokenCount.nullish() }).nullish(),
  })
  .refine(
    (usage) => (usage.input_tokens_details?.cached_tokens ?? 0) <= usage.input_tokens,
    "Cached input tokens cannot exceed input tokens",
  )
  .nullable();

export function readUsage(value: z.infer<typeof providerUsage>) {
  return value === null
    ? null
    : {
        inputTokens: value.input_tokens,
        outputTokens: value.output_tokens,
        cachedInputTokens: value.input_tokens_details?.cached_tokens ?? null,
      };
}
