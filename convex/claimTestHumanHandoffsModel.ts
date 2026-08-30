import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const handoffIdentityValidator = v.object({
  generationId: v.id("scoutLabGenerations"),
  runId: v.id("claimTestRuns"),
  userId: v.id("users"),
  reason: v.string(),
  requestedAt: v.number(),
});

export const claimTestHumanHandoffValidator = v.union(
  handoffIdentityValidator.extend({
    status: v.literal("waiting"),
    interactiveLiveViewUrl: v.string(),
    expiresAt: v.number(),
  }),
  handoffIdentityValidator.extend({
    status: v.literal("continued"),
    continuedAt: v.number(),
  }),
  handoffIdentityValidator.extend({
    status: v.literal("expired"),
    expiredAt: v.number(),
  }),
);

export const claimTestHumanHandoffStatusValidator = v.union(
  v.literal("waiting"),
  v.literal("continued"),
  v.literal("expired"),
  v.literal("missing"),
);

export const activeClaimTestHumanHandoffValidator = v.object({
  runId: v.id("claimTestRuns"),
  reason: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
  url: v.string(),
});

export const requestedClaimTestHumanHandoffValidator = v.object({
  handoffId: v.id("claimTestHumanHandoffs"),
  created: v.boolean(),
  recipientEmail: v.string(),
  productName: v.string(),
  scoutName: v.string(),
  interactiveLiveViewUrl: v.string(),
  expiresAt: v.number(),
});

function handoffIdentity(handoff: Doc<"claimTestHumanHandoffs">) {
  return {
    generationId: handoff.generationId,
    runId: handoff.runId,
    userId: handoff.userId,
    reason: handoff.reason,
    requestedAt: handoff.requestedAt,
  };
}

export async function expireClaimTestHumanHandoffForGeneration(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"scoutLabGenerations">,
) {
  const handoff = await ctx.db
    .query("claimTestHumanHandoffs")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (!handoff || handoff.status !== "waiting") return;
  await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
    ...handoffIdentity(handoff),
    status: "expired",
    expiredAt: Date.now(),
  });
}

export function terminalHandoffIdentity(handoff: Doc<"claimTestHumanHandoffs">) {
  return handoffIdentity(handoff);
}
