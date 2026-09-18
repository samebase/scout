import { type Infer, v } from "convex/values";

export const taskFailureDiagnosticValidator = v.object({
  category: v.union(
    v.literal("transient_service"),
    v.literal("rate_limit"),
    v.literal("configuration"),
    v.literal("unknown"),
  ),
  operation: v.union(
    v.literal("start"),
    v.literal("send"),
    v.literal("resume"),
    v.literal("observe"),
    v.literal("advance"),
    v.literal("cleanup"),
  ),
  occurredAtMs: v.number(),
  provider: v.union(v.literal("openai"), v.literal("convex_gateway"), v.literal("unknown")),
  httpStatus: v.optional(v.number()),
  providerCode: v.optional(v.string()),
  requestId: v.optional(v.string()),
});

export type TaskFailureDiagnostic = Infer<typeof taskFailureDiagnosticValidator>;

export function taskFailureMessage(diagnostic: TaskFailureDiagnostic | undefined): string {
  switch (diagnostic?.category ?? "unknown") {
    case "transient_service":
      return "The AI service is temporarily unavailable. Try again later.";
    case "rate_limit":
      return "The AI service is busy. Try again later.";
    case "configuration":
      return "The AI service needs attention. Contact support.";
    case "unknown":
      return "This task stopped unexpectedly. Try again or contact support.";
  }
}
