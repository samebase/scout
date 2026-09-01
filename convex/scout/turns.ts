import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  failTaskHumanHandoffForTurn,
  signalTaskHumanHandoffScoutPaused,
} from "../taskHumanHandoffsModel";
import { scoutTokenUsageValidator } from "./models";

export const TURN_START_TIMEOUT_MS = 5 * 60 * 1_000;
export const TURN_RUN_TIMEOUT_MS = 11 * 60 * 1_000;
export const EXPIRED_TURN_FAILURE = "Scout stopped before completing this turn";

export const start = internalMutation({
  args: { promptMessageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending") return false;

    const now = Date.now();
    if (turn.state.leaseExpiresAt <= now) {
      await failTaskHumanHandoffForTurn(ctx, turn._id);
      await ctx.db.patch("scoutTurns", turn._id, {
        state: { kind: "failed", failedAt: now, failure: EXPIRED_TURN_FAILURE },
      });
      return false;
    }

    const leaseExpiresAt = now + TURN_RUN_TIMEOUT_MS;
    await ctx.db.patch("scoutTurns", turn._id, {
      state: { kind: "pending", leaseExpiresAt },
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, {
      turnId: turn._id,
    });
    return true;
  },
});

export const expire = internalMutation({
  args: { turnId: v.id("scoutTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get("scoutTurns", args.turnId);
    if (!turn || turn.state.kind !== "pending" || turn.state.leaseExpiresAt > Date.now()) {
      return null;
    }
    await failTaskHumanHandoffForTurn(ctx, turn._id);
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "failed",
        failedAt: Date.now(),
        failure: EXPIRED_TURN_FAILURE,
      },
    });
    return null;
  },
});

export const complete = internalMutation({
  args: {
    promptMessageId: v.string(),
    usage: scoutTokenUsageValidator,
    firecrawlCredits: v.optional(v.number()),
    firecrawlDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn) throw new Error("Scout turn not found");
    if (turn.state.kind !== "pending") return null;
    await failTaskHumanHandoffForTurn(ctx, turn._id);
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "completed",
        completedAt: Date.now(),
        usage: args.usage,
        ...(args.firecrawlCredits === undefined ? {} : { firecrawlCredits: args.firecrawlCredits }),
        ...(args.firecrawlDurationMs === undefined
          ? {}
          : { firecrawlDurationMs: args.firecrawlDurationMs }),
      },
    });
    return null;
  },
});

export const completeHumanHandoffPause = internalMutation({
  args: {
    promptMessageId: v.string(),
    usage: scoutTokenUsageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn) throw new Error("Scout turn not found");
    if (turn.state.kind !== "pending") return null;
    const session = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_turn_id", (query) => query.eq("turnId", turn._id))
      .unique();
    const handoff = session
      ? await ctx.db
          .query("taskHumanHandoffs")
          .withIndex("by_session_id", (query) => query.eq("sessionId", session._id))
          .unique()
      : null;
    if (
      !session ||
      session.lifecycle.kind !== "active" ||
      !handoff ||
      (handoff.status !== "available" &&
        handoff.status !== "active" &&
        handoff.status !== "continued")
    ) {
      throw new Error("Active task human handoff not found");
    }
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "completed",
        completedAt: Date.now(),
        usage: args.usage,
      },
    });
    await signalTaskHumanHandoffScoutPaused(ctx, handoff);
    return null;
  },
});

export const fail = internalMutation({
  args: {
    promptMessageId: v.string(),
    failure: v.string(),
    usage: v.optional(scoutTokenUsageValidator),
    firecrawlCredits: v.optional(v.number()),
    firecrawlDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn) throw new Error("Scout turn not found");
    if (turn.state.kind !== "pending") return null;
    await failTaskHumanHandoffForTurn(ctx, turn._id);
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "failed",
        failedAt: Date.now(),
        failure: args.failure,
        ...(args.usage === undefined ? {} : { usage: args.usage }),
        ...(args.firecrawlCredits === undefined ? {} : { firecrawlCredits: args.firecrawlCredits }),
        ...(args.firecrawlDurationMs === undefined
          ? {}
          : { firecrawlDurationMs: args.firecrawlDurationMs }),
      },
    });
    return null;
  },
});
