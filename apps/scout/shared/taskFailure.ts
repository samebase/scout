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
  message: v.optional(v.string()),
});

export type TaskFailureDiagnostic = Infer<typeof taskFailureDiagnosticValidator>;
