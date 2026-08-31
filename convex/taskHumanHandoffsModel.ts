import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const taskHumanHandoffIdentityValidator = v.object({
  sessionId: v.id("taskBrowserSessions"),
  reason: v.string(),
  requestedAt: v.number(),
});

export const taskHumanHandoffValidator = v.union(
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("waiting"),
    interactiveLiveViewUrl: v.string(),
    expiresAt: v.number(),
  }),
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("continued"),
    continuedAt: v.number(),
  }),
  taskHumanHandoffIdentityValidator.extend({
    status: v.literal("expired"),
    expiredAt: v.number(),
  }),
);

export const taskHumanHandoffStatusValidator = v.union(
  v.literal("waiting"),
  v.literal("continued"),
  v.literal("expired"),
  v.literal("missing"),
);

export const activeTaskHumanHandoffValidator = v.object({
  handoffId: v.id("taskHumanHandoffs"),
  sessionId: v.id("taskBrowserSessions"),
  reason: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
  url: v.string(),
});

export const requestedTaskHumanHandoffValidator = v.object({
  handoffId: v.id("taskHumanHandoffs"),
  created: v.boolean(),
  recipientEmail: v.string(),
  productName: v.string(),
  scoutName: v.string(),
  interactiveLiveViewUrl: v.string(),
  expiresAt: v.number(),
});

function handoffIdentity(handoff: Doc<"taskHumanHandoffs">) {
  return {
    sessionId: handoff.sessionId,
    reason: handoff.reason,
    requestedAt: handoff.requestedAt,
  };
}

export async function expireTaskHumanHandoffForTurn(
  ctx: Pick<MutationCtx, "db">,
  turnId: Id<"scoutTurns">,
) {
  const session = await ctx.db
    .query("taskBrowserSessions")
    .withIndex("by_turn_id", (query) => query.eq("turnId", turnId))
    .unique();
  if (!session) return;
  const handoff = await ctx.db
    .query("taskHumanHandoffs")
    .withIndex("by_session_id", (query) => query.eq("sessionId", session._id))
    .unique();
  if (!handoff || handoff.status !== "waiting") return;
  await ctx.db.replace("taskHumanHandoffs", handoff._id, {
    ...handoffIdentity(handoff),
    status: "expired",
    expiredAt: Date.now(),
  });
}

export function terminalTaskHandoffIdentity(handoff: Doc<"taskHumanHandoffs">) {
  return handoffIdentity(handoff);
}
