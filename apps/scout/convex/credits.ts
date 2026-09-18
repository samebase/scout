import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { mutation, query } from "./functions";
import schema from "./schema";
import {
  CREDIT_POLICY,
  costUnits,
  creditsEnabled,
  currentCreditTerms,
  nonnegativeInteger,
  positiveInteger,
  signedInteger,
} from "./creditPolicy";
import {
  debitCumulativeCreditOperation,
  ensureCreditWallet,
  markCreditUnresolved,
  releaseCreditOperation,
  reserveCreditOperation,
  settleCreditOperation,
  walletForUser,
} from "./creditLedger";
import { creditSourceValidator } from "./creditsModel";

export const grantOnSignIn = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await ensureCreditWallet(ctx, userId);
    return null;
  },
});

export const ensureWallet = mutation({
  access: "access_account",
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ensureCreditWallet(ctx, ctx.viewer.userId);
    return null;
  },
});

export const balance = query({
  access: "access_account",
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      availableUnits: v.number(),
      balanceUnits: v.number(),
      reservedUnits: v.number(),
      hold: schema.doc("creditWallets").fields.hold,
    }),
  ),
  handler: async (ctx) => {
    const wallet = await walletForUser(ctx, ctx.viewer.userId);
    return wallet
      ? {
          availableUnits: wallet.balanceUnits - wallet.reservedUnits,
          balanceUnits: wallet.balanceUnits,
          reservedUnits: wallet.reservedUnits,
          hold: wallet.hold,
        }
      : null;
  },
});

export const history = query({
  access: "access_account",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("creditEntries")),
  handler: (ctx, args) =>
    ctx.db
      .query("creditEntries")
      .withIndex("by_user_id", (q) => q.eq("userId", ctx.viewer.userId))
      .order("desc")
      .paginate(args.paginationOpts),
});

export const operation = internalQuery({
  args: { reservationId: v.id("creditReservations") },
  returns: v.union(schema.doc("creditReservations"), v.null()),
  handler: (ctx, args) => ctx.db.get(args.reservationId),
});

export const reserve = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    sourceKey: v.string(),
    source: creditSourceValidator,
    maximumCostMicrodollars: v.number(),
  },
  returns: v.id("creditReservations"),
  handler: (ctx, args) => reserveCreditOperation(ctx, args),
});

export const reserveSessionAi = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), sourceKey: v.string() },
  returns: v.id("creditReservations"),
  handler: (ctx, args) =>
    reserveCreditOperation(ctx, {
      ...args,
      source: { kind: "admission_hold" },
      maximumCostMicrodollars:
        CREDIT_POLICY.initialAiReserveCredits * CREDIT_POLICY.microdollarsPerCredit,
    }),
});

export const recordSessionUsage = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    modelCostMicrodollars: v.number(),
    webSearchCalls: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reportedModel = nonnegativeInteger.parse(args.modelCostMicrodollars);
    const reportedSearches = nonnegativeInteger.parse(args.webSearchCalls);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Task session is missing");
    const previousModel = nonnegativeInteger.parse(session.chargedModelMicrodollars ?? 0);
    const previousSearches = nonnegativeInteger.parse(session.chargedWebSearchCalls ?? 0);
    const modelTotal = Math.max(previousModel, reportedModel);
    const searchTotal = Math.max(previousSearches, reportedSearches);
    if (modelTotal === previousModel && searchTotal === previousSearches) return null;

    if ((previousModel > 0 || previousSearches > 0) && !session.creditUsageTerms)
      throw new Error("Session credit conversion terms are missing");
    const terms = session.creditUsageTerms ?? currentCreditTerms();
    const searchRate = positiveInteger.parse(terms.hostedWebSearchMicrodollarsPerCall);
    const modelDeltaUnits = nonnegativeInteger.parse(
      costUnits(modelTotal, terms) - costUnits(previousModel, terms),
    );
    const searchDeltaUnits = nonnegativeInteger.parse(
      costUnits(nonnegativeInteger.parse(searchTotal * searchRate), terms) -
        costUnits(nonnegativeInteger.parse(previousSearches * searchRate), terms),
    );
    const wallet = await walletForUser(ctx, session.userId);
    if (!wallet) throw new Error("Credit wallet is missing");
    const modelBalance = signedInteger.parse(wallet.balanceUnits - modelDeltaUnits);
    const finalBalance = signedInteger.parse(modelBalance - searchDeltaUnits);
    if (modelDeltaUnits > 0) {
      await ctx.db.insert("creditEntries", {
        userId: session.userId,
        sourceKey: `session:model:${session._id}:${modelTotal}`,
        amountUnits: -modelDeltaUnits,
        balanceAfterUnits: modelBalance,
        detail: {
          kind: "session_model",
          sessionId: session._id,
          totalCostMicrodollars: modelTotal,
        },
      });
    }
    if (searchDeltaUnits > 0) {
      await ctx.db.insert("creditEntries", {
        userId: session.userId,
        sourceKey: `session:web_search:${session._id}:${searchTotal}`,
        amountUnits: -searchDeltaUnits,
        balanceAfterUnits: finalBalance,
        detail: { kind: "session_web_search", sessionId: session._id, totalCalls: searchTotal },
      });
    }
    await ctx.db.patch(wallet._id, { balanceUnits: finalBalance });
    await ctx.db.patch(session._id, {
      chargedModelMicrodollars: modelTotal,
      chargedWebSearchCalls: searchTotal,
      creditUsageTerms: terms,
    });
    return null;
  },
});

export const debitCumulative = internalMutation({
  args: { reservationId: v.id("creditReservations"), totalCostMicrodollars: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Credit reservation is missing");
    await debitCumulativeCreditOperation(ctx, reservation, args.totalCostMicrodollars);
    return null;
  },
});

export const settle = internalMutation({
  args: { reservationId: v.id("creditReservations"), costMicrodollars: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Credit reservation is missing");
    await settleCreditOperation(ctx, reservation, args.costMicrodollars);
    return null;
  },
});

export const release = internalMutation({
  args: { reservationId: v.id("creditReservations"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Credit reservation is missing");
    await releaseCreditOperation(ctx, reservation, args.reason);
    return null;
  },
});

export const unresolved = internalMutation({
  args: { reservationId: v.id("creditReservations"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Credit reservation is missing");
    await markCreditUnresolved(ctx, reservation, args.reason);
    return null;
  },
});

export const resolveManually = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    resolution: v.union(
      v.object({ kind: v.literal("settle"), costMicrodollars: v.number() }),
      v.object({ kind: v.literal("release"), reason: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { reservationId, resolution }) => {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation) throw new Error("Credit reservation is missing");
    if (resolution.kind === "settle")
      await settleCreditOperation(ctx, reservation, resolution.costMicrodollars);
    else await releaseCreditOperation(ctx, reservation, resolution.reason);
    return null;
  },
});

export const adjustManually = internalMutation({
  args: {
    userId: v.id("users"),
    reference: v.string(),
    amountUnits: v.number(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.reference.trim() || !args.reason.trim())
      throw new Error("An adjustment requires a unique reference and a reason");
    const amountUnits = signedInteger.parse(args.amountUnits);
    if (amountUnits === 0) throw new Error("An adjustment must change the balance");
    const sourceKey = `adjustment:${args.reference}`;
    const previous = await ctx.db
      .query("creditEntries")
      .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
      .unique();
    if (previous) {
      if (
        previous.userId !== args.userId ||
        previous.amountUnits !== amountUnits ||
        previous.detail.kind !== "adjustment" ||
        previous.detail.reason !== args.reason
      )
        throw new Error("Conflicting adjustment reference");
      return null;
    }
    const wallet = await walletForUser(ctx, args.userId);
    if (!wallet) throw new Error("Credit wallet is missing");
    const balanceAfterUnits = signedInteger.parse(wallet.balanceUnits + amountUnits);
    await ctx.db.insert("creditEntries", {
      userId: args.userId,
      sourceKey,
      amountUnits,
      balanceAfterUnits,
      detail: { kind: "adjustment", reason: args.reason },
    });
    await ctx.db.patch(wallet._id, { balanceUnits: balanceAfterUnits });
    return null;
  },
});

export const setHoldManually = internalMutation({
  args: { userId: v.id("users"), hold: schema.doc("creditWallets").fields.hold },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.hold.kind === "held" && !args.hold.reason.trim())
      throw new Error("A credit hold requires a reason");
    const wallet = await walletForUser(ctx, args.userId);
    if (!wallet) throw new Error("Credit wallet is missing");
    await ctx.db.patch(wallet._id, { hold: args.hold });
    return null;
  },
});

export const offer = query({
  access: "access_account",
  args: {},
  returns: v.object({
    unitsPerCredit: v.number(),
    signupCredits: v.number(),
    initialAiReserveCredits: v.number(),
    usageEnabled: v.boolean(),
  }),
  handler: () => ({
    unitsPerCredit: CREDIT_POLICY.unitsPerCredit,
    signupCredits: CREDIT_POLICY.signupCredits,
    initialAiReserveCredits: CREDIT_POLICY.initialAiReserveCredits,
    usageEnabled: creditsEnabled(),
  }),
});
