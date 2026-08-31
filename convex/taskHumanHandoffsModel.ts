import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const taskHumanHandoffIdentityValidator = v.object({
  sessionId: v.id("taskBrowserSessions"),
  reason: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
  accessTokenHash: v.string(),
});

export const taskHumanHandoffFailureValidator = v.union(
  v.literal("browser_ended"),
  v.literal("delivery_failed"),
);

export const taskHumanHandoffValidator = v.union(
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("waiting"),
  }),
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("continued"),
    continuedAt: v.number(),
  }),
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("expired"),
    expiredAt: v.number(),
  }),
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("failed"),
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
  }),
);

export const taskHumanHandoffStatusValidator = v.union(
  v.literal("waiting"),
  v.literal("continued"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("missing"),
);

export const activeTaskHumanHandoffValidator = v.object({
  handoffId: v.id("taskHumanHandoffs"),
  reason: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
});

export const requestedTaskHumanHandoffValidator = v.object({
  handoffId: v.id("taskHumanHandoffs"),
  created: v.boolean(),
  recipientEmail: v.string(),
  productName: v.string(),
  scoutName: v.string(),
  expiresAt: v.number(),
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
  }),
  v.object({
    status: v.literal("failed"),
    ...taskHumanHandoffPageContext,
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
  }),
);

function handoffIdentity(handoff: Doc<"taskHumanHandoffs">) {
  return {
    sessionId: handoff.sessionId,
    reason: handoff.reason,
    requestedAt: handoff.requestedAt,
    expiresAt: handoff.expiresAt,
    accessTokenHash: handoff.accessTokenHash,
  };
}

export async function failTaskHumanHandoffForSession(
  ctx: Pick<MutationCtx, "db">,
  sessionId: Id<"taskBrowserSessions">,
) {
  const handoff = await ctx.db
    .query("taskHumanHandoffs")
    .withIndex("by_session_id", (query) => query.eq("sessionId", sessionId))
    .unique();
  if (!handoff || handoff.status !== "waiting") return;
  const now = Date.now();
  if (handoff.expiresAt <= now) {
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...handoffIdentity(handoff),
      status: "expired",
      expiredAt: now,
    });
    return;
  }
  await ctx.db.replace("taskHumanHandoffs", handoff._id, {
    ...handoffIdentity(handoff),
    status: "failed",
    failedAt: now,
    failure: "browser_ended",
  });
}

export async function failTaskHumanHandoffForTurn(
  ctx: Pick<MutationCtx, "db">,
  turnId: Id<"scoutTurns">,
) {
  const session = await ctx.db
    .query("taskBrowserSessions")
    .withIndex("by_turn_id", (query) => query.eq("turnId", turnId))
    .unique();
  if (session) await failTaskHumanHandoffForSession(ctx, session._id);
}

export function terminalTaskHandoffIdentity(handoff: Doc<"taskHumanHandoffs">) {
  return handoffIdentity(handoff);
}
