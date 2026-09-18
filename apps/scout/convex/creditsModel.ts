import { v } from "convex/values";

export const creditFailureCodeValidator = v.union(
  v.literal("INSUFFICIENT_CREDITS"),
  v.literal("CREDIT_HOLD"),
);

export const creditUsageKindValidator = v.union(
  v.literal("model"),
  v.literal("request_check"),
  v.literal("research"),
  v.literal("browser"),
  v.literal("web_search"),
);

export const creditUsageInput = v.object({
  userId: v.id("users"),
  sessionId: v.union(v.id("agentsApiSessions"), v.null()),
  sourceKey: v.string(),
  kind: creditUsageKindValidator,
  totalCostMicrodollars: v.number(),
});

export const creditWalletValidator = v.object({
  userId: v.id("users"),
  balanceUnits: v.number(),
  hold: v.union(
    v.object({ kind: v.literal("clear") }),
    v.object({ kind: v.literal("held"), reason: v.string() }),
  ),
});

export const creditEntryValidator = v.object({
  userId: v.id("users"),
  sourceKey: v.string(),
  amountUnits: v.number(),
  balanceAfterUnits: v.number(),
  detail: v.union(
    v.object({ kind: v.literal("signup"), policyVersion: v.string() }),
    v.object({
      kind: v.literal("usage"),
      usageKind: creditUsageKindValidator,
      sessionId: v.union(v.id("agentsApiSessions"), v.null()),
      costMicrodollars: v.number(),
    }),
    v.object({ kind: v.literal("purchase"), purchaseId: v.id("creditPurchases") }),
    v.object({ kind: v.literal("refund"), purchaseId: v.id("creditPurchases") }),
    v.object({ kind: v.literal("adjustment"), reason: v.string() }),
  ),
});
