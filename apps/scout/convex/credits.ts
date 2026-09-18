import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { mutation, query } from "./functions";
import schema from "./schema";
import { CREDIT_POLICY, creditsEnabled, signedInteger } from "./creditPolicy";
import {
  assertCreditAdmission,
  ensureCreditWallet,
  recordCreditUsage,
  walletForUser,
} from "./creditLedger";
import { creditUsageInput } from "./creditsModel";
import { checkoutEnabled } from "./polarConfig";

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
      balanceUnits: v.number(),
      hold: schema.doc("creditWallets").fields.hold,
    }),
  ),
  handler: async (ctx) => {
    const wallet = await walletForUser(ctx, ctx.viewer.userId);
    return wallet
      ? {
          balanceUnits: wallet.balanceUnits,
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

export const checkBalance = internalMutation({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }) => {
    if (!creditsEnabled()) return false;
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Task session is missing");
    await assertCreditAdmission(ctx, session.userId);
    return true;
  },
});

export const recordUsage = internalMutation({
  args: creditUsageInput.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordCreditUsage(ctx, args);
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
    usageEnabled: v.boolean(),
    packCredits: v.number(),
    packPriceCents: v.number(),
    checkoutEnabled: v.boolean(),
  }),
  handler: () => ({
    unitsPerCredit: CREDIT_POLICY.unitsPerCredit,
    signupCredits: CREDIT_POLICY.signupCredits,
    usageEnabled: creditsEnabled(),
    packCredits: CREDIT_POLICY.packCredits,
    packPriceCents: CREDIT_POLICY.packPriceCents,
    checkoutEnabled: creditsEnabled() && checkoutEnabled(),
  }),
});
