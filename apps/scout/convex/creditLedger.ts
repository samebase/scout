import { ConvexError, type Infer } from "convex/values";
import { INSUFFICIENT_CREDITS_MESSAGE } from "../shared/creditFailure";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  CREDIT_POLICY,
  costUnits,
  currentCreditTerms,
  nonnegativeInteger,
  positiveInteger,
  signedInteger,
} from "./creditPolicy";
import { creditSourceValidator } from "./creditsModel";

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
    reservedUnits: 0,
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
  if (wallet.balanceUnits - wallet.reservedUnits <= 0) throw insufficientCredits();
  return wallet;
}

export async function reservationForSource(
  ctx: QueryCtx,
  sessionId: Id<"agentsApiSessions">,
  sourceKey: string,
) {
  return await ctx.db
    .query("creditReservations")
    .withIndex("by_session_id_and_source_key", (q) =>
      q.eq("sessionId", sessionId).eq("sourceKey", sourceKey),
    )
    .unique();
}

export async function reserveCreditOperation(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"agentsApiSessions">;
    sourceKey: string;
    source: Infer<typeof creditSourceValidator>;
    maximumCostMicrodollars: number;
  },
) {
  if (!args.sourceKey.trim()) throw new Error("A credit source key is required");
  const session = await ctx.db.get(args.sessionId);
  if (
    !session ||
    !session.active ||
    (session.state.kind !== "starting" &&
      session.state.kind !== "running" &&
      session.state.kind !== "checking")
  ) {
    throw new Error("Active task session not found");
  }
  const previous = await reservationForSource(ctx, session._id, args.sourceKey);
  if (previous)
    throw new ConvexError(
      "This paid operation already started. Inspect its result before retrying.",
    );
  const wallet = await assertCreditAdmission(ctx, session.userId);
  const terms = currentCreditTerms();
  const reservedUnits = costUnits(positiveInteger.parse(args.maximumCostMicrodollars), terms);
  if (reservedUnits > wallet.balanceUnits - wallet.reservedUnits) throw insufficientCredits();
  const reservationId = await ctx.db.insert("creditReservations", {
    userId: session.userId,
    sessionId: session._id,
    sourceKey: args.sourceKey,
    source: args.source,
    terms,
    reservedUnits,
    chargedMicrodollars: 0,
    chargedUnits: 0,
    state: { kind: "pending", startedAt: Date.now() },
  });
  await ctx.db.patch(wallet._id, {
    reservedUnits: nonnegativeInteger.parse(wallet.reservedUnits + reservedUnits),
  });
  return reservationId;
}

async function chargeCreditOperation(
  ctx: MutationCtx,
  reservation: Doc<"creditReservations">,
  totalCostMicrodollars: number,
  final: boolean,
) {
  const total = nonnegativeInteger.parse(totalCostMicrodollars);
  if (reservation.source.kind === "admission_hold" && total !== 0)
    throw new Error("An admission hold cannot be billed; record session usage separately");
  if (reservation.state.kind === "settled") {
    if (reservation.state.costMicrodollars !== total)
      throw new Error("Conflicting provider settlement; inspect the operation");
    return;
  }
  if (reservation.state.kind === "released")
    throw new Error("Provider usage arrived for a released reservation; inspect the operation");
  if (total < reservation.chargedMicrodollars)
    throw new Error("Cumulative usage cannot decrease; inspect the provider total");
  if (!final && total === reservation.chargedMicrodollars) return;

  const wallet = await walletForUser(ctx, reservation.userId);
  if (!wallet) throw new Error("Credit wallet is missing");
  const chargedUnits = costUnits(total, reservation.terms);
  const deltaUnits = nonnegativeInteger.parse(chargedUnits - reservation.chargedUnits);
  const previousHold = Math.max(0, reservation.reservedUnits - reservation.chargedUnits);
  const remainingHold = final ? 0 : Math.max(0, reservation.reservedUnits - chargedUnits);
  const balanceAfterUnits = signedInteger.parse(wallet.balanceUnits - deltaUnits);
  if (deltaUnits > 0) {
    await ctx.db.insert("creditEntries", {
      userId: reservation.userId,
      sourceKey: `usage:${reservation._id}:${total}`,
      amountUnits: -deltaUnits,
      balanceAfterUnits,
      detail: { kind: "usage", reservationId: reservation._id, costMicrodollars: total },
    });
  }
  await ctx.db.patch(wallet._id, {
    balanceUnits: balanceAfterUnits,
    reservedUnits: nonnegativeInteger.parse(wallet.reservedUnits - previousHold + remainingHold),
  });
  await ctx.db.patch(reservation._id, {
    chargedMicrodollars: total,
    chargedUnits,
    state: final
      ? {
          kind: "settled",
          costMicrodollars: total,
          debitedUnits: chargedUnits,
          settledAt: Date.now(),
        }
      : reservation.state,
  });
}

export async function debitCumulativeCreditOperation(
  ctx: MutationCtx,
  reservation: Doc<"creditReservations">,
  totalCostMicrodollars: number,
) {
  await chargeCreditOperation(ctx, reservation, totalCostMicrodollars, false);
}

export async function settleCreditOperation(
  ctx: MutationCtx,
  reservation: Doc<"creditReservations">,
  costMicrodollars: number,
) {
  await chargeCreditOperation(ctx, reservation, costMicrodollars, true);
}

export async function markCreditUnresolved(
  ctx: MutationCtx,
  reservation: Doc<"creditReservations">,
  reason: string,
) {
  if (!reason.trim()) throw new Error("An unresolved reservation requires a reason");
  if (reservation.state.kind === "settled" || reservation.state.kind === "released") return;
  if (reservation.state.kind === "unresolved" && reservation.state.reason === reason) return;
  await ctx.db.patch(reservation._id, {
    state: { kind: "unresolved", reason, updatedAt: Date.now() },
  });
}

export async function releaseCreditOperation(
  ctx: MutationCtx,
  reservation: Doc<"creditReservations">,
  reason: string,
) {
  if (!reason.trim()) throw new Error("Record evidence that no billable work occurred");
  if (reservation.state.kind === "released") {
    if (reservation.state.reason !== reason) throw new Error("Conflicting release reason");
    return;
  }
  if (reservation.state.kind === "settled")
    throw new Error("Settled usage must be corrected with an explicit ledger adjustment");
  if (reservation.chargedUnits > 0)
    throw new Error("Partially billed usage must be settled with its final provider total");
  const wallet = await walletForUser(ctx, reservation.userId);
  if (!wallet) throw new Error("Credit wallet is missing");
  await ctx.db.patch(wallet._id, {
    reservedUnits: nonnegativeInteger.parse(wallet.reservedUnits - reservation.reservedUnits),
  });
  await ctx.db.patch(reservation._id, {
    state: { kind: "released", reason, releasedAt: Date.now() },
  });
}
