import { vWorkflowId } from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const humanHandoffCommon = {
  sessionId: v.id("scoutBrowserSessions"),
  turnId: v.id("scoutTurns"),
  reason: v.string(),
  requestedAt: v.number(),
  claimExpiresAt: v.number(),
  accessTokenHash: v.string(),
  workflowId: vWorkflowId,
};

const humanHandoffClaim = {
  claimedAt: v.number(),
  expiresAt: v.number(),
};

export const humanHandoffFailureValidator = v.union(
  v.literal("browser_ended"),
  v.literal("delivery_failed"),
  v.literal("scout_failed"),
);

export const humanHandoffValidator = v.union(
  v.object({ ...humanHandoffCommon, status: v.literal("available") }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("active"),
  }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("continued"),
    continuedAt: v.number(),
  }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("resumed"),
    continuedAt: v.number(),
    continuationTurnId: v.id("scoutTurns"),
  }),
  v.object({
    ...humanHandoffCommon,
    status: v.literal("stopped"),
    stoppedAt: v.number(),
    claimed: v.literal(false),
  }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("stopped"),
    stoppedAt: v.number(),
    claimed: v.literal(true),
  }),
  v.object({
    ...humanHandoffCommon,
    status: v.literal("expired"),
    expiredAt: v.number(),
    claimed: v.literal(false),
  }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("expired"),
    expiredAt: v.number(),
    claimed: v.literal(true),
  }),
  v.object({
    ...humanHandoffCommon,
    status: v.literal("failed"),
    failedAt: v.number(),
    failure: humanHandoffFailureValidator,
    claimed: v.literal(false),
  }),
  v.object({
    ...humanHandoffCommon,
    ...humanHandoffClaim,
    status: v.literal("failed"),
    failedAt: v.number(),
    failure: humanHandoffFailureValidator,
    claimed: v.literal(true),
  }),
);

export function handoffCommon(handoff: Doc<"scoutHumanHandoffs">) {
  return {
    sessionId: handoff.sessionId,
    turnId: handoff.turnId,
    reason: handoff.reason,
    requestedAt: handoff.requestedAt,
    claimExpiresAt: handoff.claimExpiresAt,
    accessTokenHash: handoff.accessTokenHash,
    workflowId: handoff.workflowId,
  };
}

export function handoffClaim(handoff: Doc<"scoutHumanHandoffs">) {
  if (!("claimedAt" in handoff) || !("expiresAt" in handoff)) {
    throw new Error("Human handoff has not been claimed");
  }
  return { claimedAt: handoff.claimedAt, expiresAt: handoff.expiresAt };
}

export function handoffDeadline(handoff: Doc<"scoutHumanHandoffs">) {
  return "expiresAt" in handoff ? handoff.expiresAt : handoff.claimExpiresAt;
}

export function expiredHandoff(
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" | "active" }>,
  expiredAt: number,
) {
  return handoff.status === "active"
    ? {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "expired" as const,
        expiredAt,
        claimed: true as const,
      }
    : {
        ...handoffCommon(handoff),
        status: "expired" as const,
        expiredAt,
        claimed: false as const,
      };
}

export function failedHandoff(
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" | "active" | "continued" }>,
  args: { failedAt: number; failure: Infer<typeof humanHandoffFailureValidator> },
) {
  return handoff.status !== "available"
    ? {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "failed" as const,
        ...args,
        claimed: true as const,
      }
    : {
        ...handoffCommon(handoff),
        status: "failed" as const,
        ...args,
        claimed: false as const,
      };
}

export function stoppedHandoff(
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" | "active" | "continued" }>,
  stoppedAt: number,
) {
  return handoff.status === "available"
    ? {
        ...handoffCommon(handoff),
        status: "stopped" as const,
        stoppedAt,
        claimed: false as const,
      }
    : {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "stopped" as const,
        stoppedAt,
        claimed: true as const,
      };
}

async function failOpenHandoff(
  ctx: MutationCtx,
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" | "active" }>,
  failure: "browser_ended" | "scout_failed",
) {
  const now = Date.now();
  if (handoffDeadline(handoff) <= now) {
    await ctx.db.replace("scoutHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
    return;
  }
  await ctx.db.replace(
    "scoutHumanHandoffs",
    handoff._id,
    failedHandoff(handoff, { failedAt: now, failure }),
  );
}

export async function failHumanHandoffForSession(
  ctx: MutationCtx,
  sessionId: Id<"scoutBrowserSessions">,
) {
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_session_id", (query) => query.eq("sessionId", sessionId))
    .unique();
  if (handoff?.status === "available" || handoff?.status === "active") {
    await failOpenHandoff(ctx, handoff, "browser_ended");
  } else if (handoff?.status === "continued") {
    await ctx.db.replace(
      handoff._id,
      failedHandoff(handoff, { failedAt: Date.now(), failure: "browser_ended" }),
    );
  }
}

export async function failHumanHandoffForTurn(ctx: MutationCtx, turnId: Id<"scoutTurns">) {
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_turn_id", (query) => query.eq("turnId", turnId))
    .unique();
  if (!handoff) return false;
  if (handoff.status === "available" || handoff.status === "active") {
    await failOpenHandoff(ctx, handoff, "scout_failed");
    return true;
  } else if (handoff.status === "continued") {
    await ctx.db.replace(
      "scoutHumanHandoffs",
      handoff._id,
      failedHandoff(handoff, { failedAt: Date.now(), failure: "scout_failed" }),
    );
    return true;
  }
  return false;
}

export async function stopHumanHandoffForTurn(ctx: MutationCtx, turnId: Id<"scoutTurns">) {
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_turn_id", (query) => query.eq("turnId", turnId))
    .unique();
  if (
    !handoff ||
    (handoff.status !== "available" &&
      handoff.status !== "active" &&
      handoff.status !== "continued")
  ) {
    return;
  }
  await ctx.db.replace("scoutHumanHandoffs", handoff._id, stoppedHandoff(handoff, Date.now()));
}
