import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { failHumanHandoffForTurn, signalHumanHandoffScoutPaused } from "../humanHandoffsModel";
import { omitNullish } from "../../shared/omitNullish";
import { failPendingModelCall } from "./modelCalls";
import { scoutTokenUsageValidator } from "./models";
import type { ScoutTokenUsage } from "./models";

export const TURN_START_TIMEOUT_MS = 5 * 60 * 1_000;
export const TURN_RUN_TIMEOUT_MS = 11 * 60 * 1_000;
export const EXPIRED_TURN_FAILURE = "Scout stopped before completing this turn";
const BROWSER_CLEANUP_FALLBACK_MS = 5 * 60 * 1_000;

function mergeCumulativeUsage(
  checkpoint: ScoutTokenUsage,
  reported: ScoutTokenUsage | undefined,
): ScoutTokenUsage {
  const latest = (left: number | undefined, right: number | undefined) => {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.max(left, right);
  };
  return omitNullish({
    promptTokens: latest(checkpoint.promptTokens, reported?.promptTokens),
    completionTokens: latest(checkpoint.completionTokens, reported?.completionTokens),
    totalTokens: latest(checkpoint.totalTokens, reported?.totalTokens),
    reasoningTokens: latest(checkpoint.reasoningTokens, reported?.reasoningTokens),
    cachedInputTokens: latest(checkpoint.cachedInputTokens, reported?.cachedInputTokens),
    costUsd: latest(checkpoint.costUsd, reported?.costUsd),
  });
}

async function failPendingAgentResponse(
  ctx: MutationCtx,
  turn: Doc<"scoutTurns">,
  failure: string,
) {
  const pending = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: turn.threadId,
    order: "desc",
    statuses: ["pending"],
    upToAndIncludingMessageId: turn.promptMessageId,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  const response = pending.page[0];
  if (response?.order !== turn.order) return;
  await ctx.runMutation(components.agent.messages.finalizeMessage, {
    messageId: response._id,
    result: { status: "failed", error: failure },
  });
}

async function failPendingTurn(
  ctx: MutationCtx,
  turn: Doc<"scoutTurns">,
  failure: string,
  usage?: ScoutTokenUsage,
) {
  if (turn.state.kind === "completed") return;
  if (turn.state.kind === "failed") {
    await failPendingModelCall(ctx, turn._id, failure);
    await failPendingAgentResponse(ctx, turn, failure);
    return;
  }
  const handoffOwnsBrowserCleanup = await failHumanHandoffForTurn(ctx, turn._id);
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_scout_id_and_lifecycle_kind", (query) =>
      query.eq("scoutId", turn.scoutId).eq("lifecycle.kind", "active"),
    )
    .first();
  const cleanupSession =
    !handoffOwnsBrowserCleanup && session?.threadId === turn.threadId ? session : null;
  if (cleanupSession) {
    await ctx.db.patch(cleanupSession._id, {
      lifecycle: {
        kind: "closing",
        openedAtMs: cleanupSession.lifecycle.openedAtMs,
        closingAtMs: Date.now(),
      },
    });
  }
  await ctx.db.patch(turn._id, {
    state: {
      kind: "failed",
      failedAt: Date.now(),
      failure,
      usage: mergeCumulativeUsage(turn.state.usage, usage),
      ...omitNullish({
        firecrawlCredits: turn.state.firecrawlCredits,
        firecrawlDurationMs: turn.state.firecrawlDurationMs,
      }),
    },
  });
  await failPendingModelCall(ctx, turn._id, failure);
  await failPendingAgentResponse(ctx, turn, failure);
  if (cleanupSession) {
    await ctx.scheduler.runAfter(0, internal.humanHandoffBrowser.finishBrowserSession, {
      sessionId: cleanupSession._id,
      captureEvidence: false,
      usageTurnId: turn._id,
    });
    await ctx.scheduler.runAfter(
      BROWSER_CLEANUP_FALLBACK_MS,
      internal.scout.browserSessions.close,
      {
        sessionId: cleanupSession._id,
        providerDurationMs: null,
        creditsBilled: null,
        usageTurnId: turn._id,
      },
    );
  }
}

export const start = internalMutation({
  args: { promptMessageId: v.string() },
  returns: v.union(
    v.object({
      completedSteps: v.number(),
      usage: scoutTokenUsageValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending") return null;

    const now = Date.now();
    if (turn.state.leaseExpiresAt <= now) {
      await failPendingTurn(ctx, turn, EXPIRED_TURN_FAILURE);
      return null;
    }

    const leaseExpiresAt = now + TURN_RUN_TIMEOUT_MS;
    await ctx.db.patch("scoutTurns", turn._id, {
      state: { ...turn.state, leaseExpiresAt },
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, {
      turnId: turn._id,
    });
    return { completedSteps: turn.state.completedSteps, usage: turn.state.usage };
  },
});

export const continueAfterSlice = internalMutation({
  args: {
    promptMessageId: v.string(),
    previousCompletedSteps: v.number(),
    completedSteps: v.number(),
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
    if (!turn || turn.state.kind !== "pending") {
      throw new Error("Active Scout turn not found");
    }
    if (turn.state.leaseExpiresAt <= Date.now()) {
      throw new Error("Scout turn expired before the next generation slice");
    }
    if (turn.state.completedSteps !== args.previousCompletedSteps) {
      throw new Error("Scout turn progress changed during generation");
    }
    if (args.completedSteps <= args.previousCompletedSteps) {
      throw new Error("Scout turn made no generation progress");
    }
    const leaseExpiresAt = Date.now() + TURN_RUN_TIMEOUT_MS;
    await ctx.db.patch(turn._id, {
      state: {
        ...turn.state,
        leaseExpiresAt,
        completedSteps: args.completedSteps,
        usage: args.usage,
      },
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, {
      turnId: turn._id,
    });
    return null;
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
    await failPendingTurn(ctx, turn, EXPIRED_TURN_FAILURE);
    return null;
  },
});

export const complete = internalMutation({
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
    await failHumanHandoffForTurn(ctx, turn._id);
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "completed",
        completedAt: Date.now(),
        usage: args.usage,
        ...omitNullish({
          firecrawlCredits: turn.state.firecrawlCredits,
          firecrawlDurationMs: turn.state.firecrawlDurationMs,
        }),
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
    const handoff = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_turn_id", (query) => query.eq("turnId", turn._id))
      .unique();
    const session = handoff ? await ctx.db.get("scoutBrowserSessions", handoff.sessionId) : null;
    if (
      !session ||
      session.lifecycle.kind !== "active" ||
      session.threadId !== turn.threadId ||
      session.scoutId !== turn.scoutId ||
      !handoff ||
      (handoff.status !== "available" &&
        handoff.status !== "active" &&
        handoff.status !== "continued")
    ) {
      throw new Error("Active human handoff not found");
    }
    await ctx.db.patch("scoutTurns", turn._id, {
      state: {
        kind: "completed",
        completedAt: Date.now(),
        usage: args.usage,
        ...omitNullish({
          firecrawlCredits: turn.state.firecrawlCredits,
          firecrawlDurationMs: turn.state.firecrawlDurationMs,
        }),
      },
    });
    await signalHumanHandoffScoutPaused(ctx, handoff);
    return null;
  },
});

export const fail = internalMutation({
  args: {
    promptMessageId: v.string(),
    failure: v.string(),
    usage: v.optional(scoutTokenUsageValidator),
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
    await failPendingTurn(ctx, turn, args.failure, args.usage);
    return null;
  },
});

export const failWorkflow = internalMutation({
  args: { turnId: v.id("scoutTurns"), failure: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (turn) {
      await failPendingTurn(ctx, turn, args.failure);
    }
    return null;
  },
});
