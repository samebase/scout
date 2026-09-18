import { v } from "convex/values";
export const creditFailureCodeValidator = v.union(
  v.literal("INSUFFICIENT_CREDITS"),
  v.literal("CREDIT_HOLD"),
);

export const creditTermsValidator = v.object({
  version: v.string(),
  unitsPerCredit: v.number(),
  microdollarsPerCredit: v.number(),
  hostedWebSearchMicrodollarsPerCall: v.number(),
});

export const creditSourceKindValidator = v.union(
  v.literal("model"),
  v.literal("request_check"),
  v.literal("research"),
  v.literal("browser"),
  v.literal("web_search"),
  v.literal("admission_hold"),
);
export const creditSourceValidator = v.object({ kind: creditSourceKindValidator });

export const creditReservationValidator = v.object({
  userId: v.id("users"),
  sessionId: v.id("agentsApiSessions"),
  sourceKey: v.string(),
  source: creditSourceValidator,
  terms: creditTermsValidator,
  reservedUnits: v.number(),
  chargedMicrodollars: v.number(),
  chargedUnits: v.number(),
  state: v.union(
    v.object({ kind: v.literal("pending"), startedAt: v.number() }),
    v.object({ kind: v.literal("unresolved"), reason: v.string(), updatedAt: v.number() }),
    v.object({
      kind: v.literal("settled"),
      costMicrodollars: v.number(),
      debitedUnits: v.number(),
      settledAt: v.number(),
    }),
    v.object({ kind: v.literal("released"), reason: v.string(), releasedAt: v.number() }),
  ),
});

export const creditWalletValidator = v.object({
  userId: v.id("users"),
  balanceUnits: v.number(),
  reservedUnits: v.number(),
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
      reservationId: v.id("creditReservations"),
      costMicrodollars: v.number(),
    }),
    v.object({ kind: v.literal("adjustment"), reason: v.string() }),
    v.object({
      kind: v.literal("session_model"),
      sessionId: v.id("agentsApiSessions"),
      totalCostMicrodollars: v.number(),
    }),
    v.object({
      kind: v.literal("session_web_search"),
      sessionId: v.id("agentsApiSessions"),
      totalCalls: v.number(),
    }),
  ),
});
