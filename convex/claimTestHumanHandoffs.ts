import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAppUser } from "./access";
import {
  activeClaimTestHumanHandoffValidator,
  claimTestHumanHandoffStatusValidator,
  requestedClaimTestHumanHandoffValidator,
  terminalHandoffIdentity,
} from "./claimTestHumanHandoffsModel";
import { requireFirecrawlLiveViewUrl } from "./scout/lib/firecrawlLiveView";

const HUMAN_HANDOFF_WAIT_MS = 5 * 60 * 1_000;
const MAX_HANDOFF_REASON_LENGTH = 500;

function boundedReason(value: string) {
  const reason = value.trim().replaceAll(/\s+/g, " ");
  if (!reason) throw new Error("Human help reason cannot be empty");
  if (Array.from(reason).length > MAX_HANDOFF_REASON_LENGTH) {
    throw new Error(`Human help reason must be ${MAX_HANDOFF_REASON_LENGTH} characters or fewer`);
  }
  return reason;
}

function requestResult(args: {
  handoff: Extract<Doc<"claimTestHumanHandoffs">, { status: "waiting" }>;
  created: boolean;
  recipientEmail: string;
  productName: string;
  scoutName: string;
}) {
  return {
    handoffId: args.handoff._id,
    created: args.created,
    recipientEmail: args.recipientEmail,
    productName: args.productName,
    scoutName: args.scoutName,
    interactiveLiveViewUrl: args.handoff.interactiveLiveViewUrl,
    expiresAt: args.handoff.expiresAt,
  };
}

export const active = query({
  args: { sessionId: v.id("claimTestBrowserSessions") },
  returns: v.union(activeClaimTestHumanHandoffValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const session = await ctx.db.get("claimTestBrowserSessions", args.sessionId);
    if (!session || session.userId !== userId || session.lifecycle.kind !== "active") return null;
    const run = await ctx.db.get("claimTestRuns", session.runId);
    if (!run || run.userId !== userId) return null;
    const handoff = await ctx.db
      .query("claimTestHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (!handoff || handoff.status !== "waiting") return null;
    if (
      handoff.runId !== run._id ||
      handoff.userId !== userId ||
      handoff.generationId !== session.generationId
    ) {
      throw new Error("Claim test human handoff has an invalid ownership binding");
    }
    return {
      handoffId: handoff._id,
      sessionId: handoff.sessionId,
      runId: handoff.runId,
      reason: handoff.reason,
      requestedAt: handoff.requestedAt,
      expiresAt: handoff.expiresAt,
      url: requireFirecrawlLiveViewUrl(handoff.interactiveLiveViewUrl),
    };
  },
});

export const continueHandoff = mutation({
  args: { handoffId: v.id("claimTestHumanHandoffs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const handoff = await ctx.db.get("claimTestHumanHandoffs", args.handoffId);
    if (!handoff || handoff.status !== "waiting") return false;
    if (handoff.userId !== userId) return false;
    const [run, session, generation] = await Promise.all([
      ctx.db.get("claimTestRuns", handoff.runId),
      ctx.db.get("claimTestBrowserSessions", handoff.sessionId),
      ctx.db.get("scoutLabGenerations", handoff.generationId),
    ]);
    const continuedAt = Date.now();
    if (handoff.expiresAt <= continuedAt) {
      await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
        ...terminalHandoffIdentity(handoff),
        status: "expired",
        expiredAt: continuedAt,
      });
      return false;
    }
    if (
      !run ||
      run.userId !== userId ||
      run.state.kind !== "running" ||
      run.state.generationId !== handoff.generationId ||
      !session ||
      session.runId !== run._id ||
      session.generationId !== handoff.generationId ||
      session.userId !== userId ||
      session.lifecycle.kind !== "active" ||
      !generation ||
      generation.threadId !== run.threadId ||
      generation.scoutId !== run.scoutId ||
      generation.status !== "pending"
    ) {
      return false;
    }
    await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
      ...terminalHandoffIdentity(handoff),
      status: "continued",
      continuedAt,
    });
    return true;
  },
});

export const request = internalMutation({
  args: {
    promptMessageId: v.string(),
    reason: v.string(),
    interactiveLiveViewUrl: v.string(),
  },
  returns: requestedClaimTestHumanHandoffValidator,
  handler: async (ctx, args) => {
    const reason = boundedReason(args.reason);
    const interactiveLiveViewUrl = requireFirecrawlLiveViewUrl(args.interactiveLiveViewUrl);
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!generation || generation.status !== "pending") {
      throw new Error("Active claim test generation not found");
    }
    const run = await ctx.db
      .query("claimTestRuns")
      .withIndex("by_thread_id", (index) => index.eq("threadId", generation.threadId))
      .unique();
    if (!run || run.state.kind !== "running" || run.state.generationId !== generation._id) {
      throw new Error("Claim test run not found");
    }
    const browserSession = await ctx.db
      .query("claimTestBrowserSessions")
      .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
      .unique();
    if (
      !browserSession ||
      browserSession.runId !== run._id ||
      browserSession.userId !== run.userId ||
      browserSession.lifecycle.kind !== "active"
    ) {
      throw new Error("Active claim test browser session not found");
    }

    const [user, product, scout] = await Promise.all([
      ctx.db.get("users", run.userId),
      ctx.db.get("products", run.productId),
      ctx.db.get("scouts", run.scoutId),
    ]);
    const recipientEmail = user?.email?.trim();
    if (!recipientEmail) throw new Error("Claim test operator has no email address");
    if (!product || !scout) throw new Error("Claim test human handoff context is unavailable");

    const existing = await ctx.db
      .query("claimTestHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", browserSession._id))
      .unique();
    if (existing?.status === "waiting") {
      if (existing.runId !== run._id || existing.userId !== run.userId) {
        throw new Error("Claim test human handoff has an invalid run binding");
      }
      if (existing.interactiveLiveViewUrl !== interactiveLiveViewUrl) {
        throw new Error("Claim test already has a different interactive browser link");
      }
      return requestResult({
        handoff: existing,
        created: false,
        recipientEmail,
        productName: product.name,
        scoutName: scout.displayName,
      });
    }
    if (existing) {
      throw new Error("Claim test human handoff has already ended");
    }

    const requestedAt = Date.now();
    const expiresAt = requestedAt + HUMAN_HANDOFF_WAIT_MS;
    const handoffFields = {
      sessionId: browserSession._id,
      generationId: generation._id,
      runId: run._id,
      userId: run.userId,
      reason,
      requestedAt,
      status: "waiting" as const,
      interactiveLiveViewUrl,
      expiresAt,
    };
    const handoffId: Id<"claimTestHumanHandoffs"> = await ctx.db.insert(
      "claimTestHumanHandoffs",
      handoffFields,
    );
    await ctx.scheduler.runAt(expiresAt, internal.claimTestHumanHandoffs.expire, { handoffId });
    const handoff = await ctx.db.get("claimTestHumanHandoffs", handoffId);
    if (!handoff || handoff.status !== "waiting") {
      throw new Error("Claim test human handoff could not be created");
    }
    return requestResult({
      handoff,
      created: true,
      recipientEmail,
      productName: product.name,
      scoutName: scout.displayName,
    });
  },
});

export const getStatus = internalQuery({
  args: { handoffId: v.id("claimTestHumanHandoffs") },
  returns: claimTestHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("claimTestHumanHandoffs", args.handoffId);
    return handoff?.status ?? "missing";
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("claimTestHumanHandoffs") },
  returns: claimTestHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("claimTestHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "waiting") return handoff.status;
    await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
      ...terminalHandoffIdentity(handoff),
      status: "expired",
      expiredAt: Date.now(),
    });
    return "expired";
  },
});
