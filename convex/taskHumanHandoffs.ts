import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAppUser } from "./access";
import {
  activeTaskHumanHandoffValidator,
  requestedTaskHumanHandoffValidator,
  taskHumanHandoffStatusValidator,
  terminalTaskHandoffIdentity,
} from "./taskHumanHandoffsModel";
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

async function handoffContext(ctx: Pick<QueryCtx, "db">, sessionId: Id<"taskBrowserSessions">) {
  const session = await ctx.db.get("taskBrowserSessions", sessionId);
  const attempt = session ? await ctx.db.get("taskAttempts", session.attemptId) : null;
  const task = attempt ? await ctx.db.get("productTasks", attempt.taskId) : null;
  const turn = session ? await ctx.db.get("scoutTurns", session.turnId) : null;
  if (
    !session ||
    !attempt ||
    !task ||
    !turn ||
    turn.threadId !== attempt.threadId ||
    turn.scoutId !== attempt.scoutId
  ) {
    return null;
  }
  return { session, attempt, task, turn };
}

function requestResult(args: {
  handoff: Extract<Doc<"taskHumanHandoffs">, { status: "waiting" }>;
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
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.union(activeTaskHumanHandoffValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const context = await handoffContext(ctx, args.sessionId);
    if (!context || context.task.userId !== userId || context.session.lifecycle.kind !== "active") {
      return null;
    }
    const handoff = await ctx.db
      .query("taskHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", context.session._id))
      .unique();
    if (!handoff || handoff.status !== "waiting") return null;
    return {
      handoffId: handoff._id,
      sessionId: handoff.sessionId,
      reason: handoff.reason,
      requestedAt: handoff.requestedAt,
      expiresAt: handoff.expiresAt,
      url: requireFirecrawlLiveViewUrl(handoff.interactiveLiveViewUrl),
    };
  },
});

export const continueHandoff = mutation({
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    if (!handoff || handoff.status !== "waiting") return false;
    const context = await handoffContext(ctx, handoff.sessionId);
    if (!context || context.task.userId !== userId) return false;
    const continuedAt = Date.now();
    if (handoff.expiresAt <= continuedAt) {
      await ctx.db.replace("taskHumanHandoffs", handoff._id, {
        ...terminalTaskHandoffIdentity(handoff),
        status: "expired",
        expiredAt: continuedAt,
      });
      return false;
    }
    if (context.session.lifecycle.kind !== "active" || context.turn.state.kind !== "pending") {
      return false;
    }
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...terminalTaskHandoffIdentity(handoff),
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
  returns: requestedTaskHumanHandoffValidator,
  handler: async (ctx, args) => {
    const reason = boundedReason(args.reason);
    const interactiveLiveViewUrl = requireFirecrawlLiveViewUrl(args.interactiveLiveViewUrl);
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending") throw new Error("Active task turn not found");
    const attempt = await ctx.db
      .query("taskAttempts")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!attempt || attempt.scoutId !== turn.scoutId) throw new Error("Task attempt not found");
    const task = await ctx.db.get("productTasks", attempt.taskId);
    const session = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_turn_id", (index) => index.eq("turnId", turn._id))
      .unique();
    if (
      !task ||
      !session ||
      session.attemptId !== attempt._id ||
      session.lifecycle.kind !== "active"
    ) {
      throw new Error("Active task browser session not found");
    }
    const [user, product, scout] = await Promise.all([
      ctx.db.get("users", task.userId),
      ctx.db.get("products", task.productId),
      ctx.db.get("scouts", attempt.scoutId),
    ]);
    const recipientEmail = user?.email?.trim();
    if (!recipientEmail) throw new Error("Task operator has no email address");
    if (!product || !scout) throw new Error("Human handoff context is unavailable");
    const existing = await ctx.db
      .query("taskHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (existing?.status === "waiting") {
      if (existing.interactiveLiveViewUrl !== interactiveLiveViewUrl) {
        throw new Error("Task already has a different interactive browser link");
      }
      return requestResult({
        handoff: existing,
        created: false,
        recipientEmail,
        productName: product.name,
        scoutName: scout.displayName,
      });
    }
    if (existing) throw new Error("Task human handoff has already ended");
    const requestedAt = Date.now();
    const expiresAt = requestedAt + HUMAN_HANDOFF_WAIT_MS;
    const handoffId: Id<"taskHumanHandoffs"> = await ctx.db.insert("taskHumanHandoffs", {
      sessionId: session._id,
      reason,
      requestedAt,
      status: "waiting",
      interactiveLiveViewUrl,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.taskHumanHandoffs.expire, { handoffId });
    const handoff = await ctx.db.get("taskHumanHandoffs", handoffId);
    if (!handoff || handoff.status !== "waiting") {
      throw new Error("Task human handoff could not be created");
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
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: taskHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    return handoff?.status ?? "missing";
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: taskHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "waiting") return handoff.status;
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...terminalTaskHandoffIdentity(handoff),
      status: "expired",
      expiredAt: Date.now(),
    });
    return "expired";
  },
});
