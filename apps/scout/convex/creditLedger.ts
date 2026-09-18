import { ConvexError, type Infer } from "convex/values";
import { INSUFFICIENT_CREDITS_MESSAGE } from "../shared/creditFailure";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { CREDIT_POLICY, costUnits, nonnegativeInteger, signedInteger } from "./creditPolicy";
import { creditUsageInput } from "./creditsModel";

export function insufficientCredits() {
  return new ConvexError({ code: "INSUFFICIENT_CREDITS", message: INSUFFICIENT_CREDITS_MESSAGE });
}

export async function walletForUser(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("creditWallets")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
}

export async function ensureCreditWallet(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (
    !user ||
    user.state === "deleted" ||
    user.state === "deleting" ||
    user.emailVerificationTime === undefined
  ) {
    throw new ConvexError("A verified, active account is required");
  }
  const existing = await walletForUser(ctx, userId);
  if (existing) return existing;
  const sourceKey = `signup:${userId}`;
  const priorGrant = await ctx.db
    .query("creditEntries")
    .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
    .unique();
  if (priorGrant) throw new Error("Signup grant exists without its wallet; inspect the ledger");
  const balanceUnits = nonnegativeInteger.parse(
    CREDIT_POLICY.signupCredits * CREDIT_POLICY.unitsPerCredit,
  );
  const walletId = await ctx.db.insert("creditWallets", {
    userId,
    balanceUnits,
    hold: { kind: "clear" },
  });
  await ctx.db.insert("creditEntries", {
    userId,
    sourceKey,
    amountUnits: balanceUnits,
    balanceAfterUnits: balanceUnits,
    detail: { kind: "signup", policyVersion: CREDIT_POLICY.version },
  });
  const wallet = await ctx.db.get(walletId);
  if (!wallet) throw new Error("Credit wallet was not created");
  return wallet;
}

export async function assertCreditAdmission(ctx: MutationCtx, userId: Id<"users">) {
  const wallet = await ensureCreditWallet(ctx, userId);
  if (wallet.hold.kind === "held")
    throw new ConvexError({ code: "CREDIT_HOLD", message: wallet.hold.reason });
  if (wallet.balanceUnits <= 0) throw insufficientCredits();
  return wallet;
}

export async function recordCreditUsage(ctx: MutationCtx, args: Infer<typeof creditUsageInput>) {
  const totalCostMicrodollars = nonnegativeInteger.parse(args.totalCostMicrodollars);
  if (!args.sourceKey.trim()) throw new Error("A usage source key is required");
  if (args.sessionId) {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId)
      throw new Error("Usage does not belong to this user");
  }
  const previous = await ctx.db
    .query("creditUsageTotals")
    .withIndex("by_source_key", (q) => q.eq("sourceKey", args.sourceKey))
    .unique();
  if (
    previous &&
    (previous.userId !== args.userId ||
      previous.sessionId !== args.sessionId ||
      previous.kind !== args.kind)
  )
    throw new Error("Usage source belongs to a different operation");
  if (totalCostMicrodollars <= (previous?.totalCostMicrodollars ?? 0)) return;

  const chargedUnits = costUnits(totalCostMicrodollars, CREDIT_POLICY);
  const deltaUnits = chargedUnits - (previous?.chargedUnits ?? 0);
  const wallet = await walletForUser(ctx, args.userId);
  if (!wallet) throw new Error("Credit wallet is missing");
  const balanceAfterUnits = signedInteger.parse(wallet.balanceUnits - deltaUnits);
  if (deltaUnits > 0) {
    await ctx.db.insert("creditEntries", {
      userId: args.userId,
      sourceKey: `usage:${args.sourceKey}:${totalCostMicrodollars}`,
      amountUnits: -deltaUnits,
      balanceAfterUnits,
      detail: {
        kind: "usage",
        usageKind: args.kind,
        sessionId: args.sessionId,
        costMicrodollars: totalCostMicrodollars,
      },
    });
    await ctx.db.patch(wallet._id, { balanceUnits: balanceAfterUnits });
  }
  if (previous) await ctx.db.patch(previous._id, { totalCostMicrodollars, chargedUnits });
  else await ctx.db.insert("creditUsageTotals", { ...args, totalCostMicrodollars, chargedUnits });
}
