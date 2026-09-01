import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  taskHumanHandoffOutcomeEvent,
  taskHumanHandoffScoutPausedEvent,
  taskHumanHandoffWorkflow,
} from "./taskHumanHandoffWorkflow";

const taskHumanHandoffCommon = {
  sessionId: v.id("taskBrowserSessions"),
  reason: v.string(),
  requestedAt: v.number(),
  claimExpiresAt: v.number(),
  accessTokenHash: v.string(),
  workflowId: v.string(),
};

const taskHumanHandoffClaim = {
  claimedAt: v.number(),
  expiresAt: v.number(),
};

export const taskHumanHandoffFailureValidator = v.union(
  v.literal("browser_ended"),
  v.literal("delivery_failed"),
);

export const taskHumanHandoffValidator = v.union(
  v.object({ ...taskHumanHandoffCommon, status: v.literal("available") }),
  v.object({
    ...taskHumanHandoffCommon,
    ...taskHumanHandoffClaim,
    status: v.literal("active"),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    ...taskHumanHandoffClaim,
    status: v.literal("continued"),
    continuedAt: v.number(),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    ...taskHumanHandoffClaim,
    status: v.literal("resumed"),
    continuedAt: v.number(),
    continuationTurnId: v.id("scoutTurns"),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    status: v.literal("expired"),
    expiredAt: v.number(),
    claimed: v.literal(false),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    ...taskHumanHandoffClaim,
    status: v.literal("expired"),
    expiredAt: v.number(),
    claimed: v.literal(true),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    status: v.literal("failed"),
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
    claimed: v.literal(false),
  }),
  v.object({
    ...taskHumanHandoffCommon,
    ...taskHumanHandoffClaim,
    status: v.literal("failed"),
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
    claimed: v.literal(true),
  }),
);

export const taskHumanHandoffStatusValidator = v.union(
  v.literal("available"),
  v.literal("active"),
  v.literal("continued"),
  v.literal("resumed"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("missing"),
);

const activeTaskHumanHandoffContext = {
  handoffId: v.id("taskHumanHandoffs"),
  reason: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
};

export const activeTaskHumanHandoffValidator = v.union(
  v.object({ ...activeTaskHumanHandoffContext, phase: v.literal("unclaimed") }),
  v.object({ ...activeTaskHumanHandoffContext, phase: v.literal("claimed") }),
);

export const requestedTaskHumanHandoffValidator = v.object({
  handoffId: v.id("taskHumanHandoffs"),
  created: v.boolean(),
  recipientEmail: v.string(),
  productName: v.string(),
  scoutName: v.string(),
  claimExpiresAt: v.number(),
});

export const taskHumanHandoffDestinationValidator = v.object({
  domain: v.string(),
  taskId: v.id("productTasks"),
  attemptId: v.id("taskAttempts"),
});

const taskHumanHandoffPageContext = {
  handoffId: v.id("taskHumanHandoffs"),
  reason: v.string(),
  scoutName: v.string(),
  destination: v.optional(taskHumanHandoffDestinationValidator),
};

export const taskHumanHandoffPageValidator = v.union(
  v.object({ status: v.literal("invalid") }),
  v.object({
    status: v.literal("waiting"),
    ...taskHumanHandoffPageContext,
    expiresAt: v.number(),
    serverNow: v.number(),
    interactiveLiveViewUrl: v.string(),
  }),
  v.object({
    status: v.literal("continued"),
    ...taskHumanHandoffPageContext,
    continuedAt: v.number(),
  }),
  v.object({
    status: v.literal("expired"),
    ...taskHumanHandoffPageContext,
    expiredAt: v.number(),
    claimed: v.boolean(),
  }),
  v.object({
    status: v.literal("failed"),
    ...taskHumanHandoffPageContext,
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
  }),
);

export function handoffCommon(handoff: Doc<"taskHumanHandoffs">) {
  return {
    sessionId: handoff.sessionId,
    reason: handoff.reason,
    requestedAt: handoff.requestedAt,
    claimExpiresAt: handoff.claimExpiresAt,
    accessTokenHash: handoff.accessTokenHash,
    workflowId: handoff.workflowId,
  };
}

export function handoffClaim(handoff: Doc<"taskHumanHandoffs">) {
  if (!("claimedAt" in handoff) || !("expiresAt" in handoff)) {
    throw new Error("Task human handoff has not been claimed");
  }
  return { claimedAt: handoff.claimedAt, expiresAt: handoff.expiresAt };
}

export function handoffDeadline(handoff: Doc<"taskHumanHandoffs">) {
  return "expiresAt" in handoff ? handoff.expiresAt : handoff.claimExpiresAt;
}

export function expiredHandoff(
  handoff: Extract<Doc<"taskHumanHandoffs">, { status: "available" | "active" }>,
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
  handoff: Extract<Doc<"taskHumanHandoffs">, { status: "available" | "active" }>,
  args: { failedAt: number; failure: "browser_ended" | "delivery_failed" },
) {
  return handoff.status === "active"
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

async function sendOutcome(
  ctx: MutationCtx,
  handoff: Doc<"taskHumanHandoffs">,
  kind: "continued" | "expired" | "failed",
) {
  await taskHumanHandoffWorkflow.sendEvent(ctx, {
    ...taskHumanHandoffOutcomeEvent,
    workflowId: handoff.workflowId as WorkflowId,
    value: { kind },
  });
}

export async function failTaskHumanHandoffForSession(
  ctx: MutationCtx,
  sessionId: Id<"taskBrowserSessions">,
) {
  const handoff = await ctx.db
    .query("taskHumanHandoffs")
    .withIndex("by_session_id", (query) => query.eq("sessionId", sessionId))
    .unique();
  if (!handoff || (handoff.status !== "available" && handoff.status !== "active")) return;
  const now = Date.now();
  if (handoffDeadline(handoff) <= now) {
    await ctx.db.replace("taskHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
    await sendOutcome(ctx, handoff, "expired");
    return;
  }
  await ctx.db.replace(
    "taskHumanHandoffs",
    handoff._id,
    failedHandoff(handoff, { failedAt: now, failure: "browser_ended" }),
  );
  await sendOutcome(ctx, handoff, "failed");
}

export async function failTaskHumanHandoffForTurn(ctx: MutationCtx, turnId: Id<"scoutTurns">) {
  const session = await ctx.db
    .query("taskBrowserSessions")
    .withIndex("by_turn_id", (query) => query.eq("turnId", turnId))
    .unique();
  if (session) await failTaskHumanHandoffForSession(ctx, session._id);
}

export async function signalTaskHumanHandoffOutcome(
  ctx: MutationCtx,
  handoff: Doc<"taskHumanHandoffs">,
  kind: "continued" | "expired" | "failed",
) {
  await sendOutcome(ctx, handoff, kind);
}

export async function signalTaskHumanHandoffScoutPaused(
  ctx: MutationCtx,
  handoff: Doc<"taskHumanHandoffs">,
) {
  await taskHumanHandoffWorkflow.sendEvent(ctx, {
    ...taskHumanHandoffScoutPausedEvent,
    workflowId: handoff.workflowId as WorkflowId,
    value: null,
  });
}
