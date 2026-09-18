import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { failHumanHandoffForTurn, stopHumanHandoffForTurn } from "../humanHandoffsModel";
import { omitNullish } from "../../shared/omitNullish";
import { failPendingModelCall } from "./modelCalls";
import type { ScoutTokenUsage } from "./models";
import { scoutTurnWorkflow } from "./turnWorkflow";
export const EXPIRED_TURN_FAILURE = "Scout stopped before completing this turn";
const BROWSER_CLEANUP_FALLBACK_MS = 5 * 60 * 1_000;
const MAX_STOP_CLEANUP_FAILURE_LENGTH = 2_000;

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
  if (
    turn.state.kind === "completed" ||
    turn.state.kind === "stopping" ||
    turn.state.kind === "replacing" ||
    turn.state.kind === "stopped"
  ) {
    return;
  }
  if (turn.state.kind === "failed") {
    await failPendingModelCall(ctx, turn._id, failure);
    await failPendingAgentResponse(ctx, turn, failure);
    return;
  }
  await failHumanHandoffForTurn(ctx, turn._id);
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", turn.threadId))
    .order("desc")
    .first();
  const cleanupSession =
    session?.scoutId === turn.scoutId &&
    (session.lifecycle.kind === "active" || session.lifecycle.kind === "closing")
      ? session
      : null;
  if (cleanupSession?.lifecycle.kind === "active") {
    await ctx.db.patch(cleanupSession._id, {
      lifecycle: {
        ...cleanupSession.lifecycle,
        kind: "closing",
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

export async function stopTurn(ctx: MutationCtx, turn: Doc<"scoutTurns">) {
  if (turn.state.kind !== "pending" && turn.state.kind !== "completed") return false;
  await stopHumanHandoffForTurn(ctx, turn._id);
  const stopRequestedAt = Date.now();
  const usage = turn.state.usage;
  await ctx.db.patch(turn._id, {
    state: {
      kind: "stopping",
      stopRequestedAt,
      generationFinished: turn.state.kind === "completed",
      usage,
      ...omitNullish({
        firecrawlCredits: turn.state.firecrawlCredits,
        firecrawlDurationMs: turn.state.firecrawlDurationMs,
      }),
    },
  });
  if (turn.state.kind === "pending") {
    await failPendingAgentResponse(ctx, turn, "Stopped by user");
  }
  await finalizeStoppingTurn(ctx, turn._id);
  return true;
}

export async function finalizeStoppingTurn(ctx: MutationCtx, turnId: Doc<"scoutTurns">["_id"]) {
  const turn = await ctx.db.get("scoutTurns", turnId);
  if (!turn || turn.state.kind !== "stopping" || !turn.state.generationFinished) return;
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", turn.threadId))
    .order("desc")
    .first();
  if (session && session.lifecycle.kind !== "closed") return;
  await ctx.db.patch(turn._id, {
    state: {
      kind: "stopped",
      stoppedAt: Date.now(),
      usage: turn.state.usage,
      ...omitNullish({
        firecrawlCredits: turn.state.firecrawlCredits,
        firecrawlDurationMs: turn.state.firecrawlDurationMs,
      }),
    },
  });
}

export async function continueStoppingTurn(ctx: MutationCtx, turnId: Doc<"scoutTurns">["_id"]) {
  const turn = await ctx.db.get("scoutTurns", turnId);
  if (!turn || turn.state.kind !== "stopping" || !turn.state.generationFinished) return;
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", turn.threadId))
    .order("desc")
    .first();
  if (session?.lifecycle.kind === "active" || session?.lifecycle.kind === "closing") {
    const { cleanupFailure: _cleanupFailure, ...state } = turn.state;
    await ctx.db.patch(turn._id, { state });
    await ctx.db.patch(session._id, {
      lifecycle: { ...session.lifecycle, kind: "closing", closingAtMs: Date.now() },
    });
    await scoutTurnWorkflow.start(
      ctx,
      internal.scout.turnLifecycle.cleanupBrowser,
      { sessionId: session._id, turnId: turn._id },
      {
        startAsync: true,
        onComplete: internal.scout.turnLifecycle.onBrowserCleanupComplete,
        context: { sessionId: session._id, turnId: turn._id },
      },
    );
    return;
  }
  await ctx.scheduler.runAfter(0, internal.scout.turns.finalizeStopping, { turnId: turn._id });
}

export async function finishStoppingTurn(ctx: MutationCtx, turnId: Doc<"scoutTurns">["_id"]) {
  const turn = await ctx.db.get("scoutTurns", turnId);
  if (!turn || turn.state.kind !== "stopping" || turn.state.generationFinished) return;
  await ctx.db.patch(turn._id, {
    state: { ...turn.state, generationFinished: true },
  });
  await continueStoppingTurn(ctx, turn._id);
}

export async function recordBrowserCleanupFailure(
  ctx: MutationCtx,
  args: {
    turnId: Doc<"scoutTurns">["_id"];
    sessionId: Doc<"scoutBrowserSessions">["_id"];
    failure: string;
  },
) {
  const [turn, session] = await Promise.all([
    ctx.db.get("scoutTurns", args.turnId),
    ctx.db.get("scoutBrowserSessions", args.sessionId),
  ]);
  if (!turn || !session) return;
  if (session?.lifecycle.kind === "closed") {
    if (turn.state.kind === "stopping" && turn.state.generationFinished) {
      await ctx.scheduler.runAfter(0, internal.scout.turns.finalizeStopping, { turnId: turn._id });
    }
    return;
  }
  if (session?.lifecycle.kind === "closing") {
    const { closingAtMs: _closingAtMs, ...lifecycle } = session.lifecycle;
    await ctx.db.patch(session._id, { lifecycle: { ...lifecycle, kind: "active" } });
  }
  if (turn.state.kind === "stopping" && turn.state.generationFinished) {
    const failure = args.failure.trim();
    await ctx.db.patch(turn._id, {
      state: {
        ...turn.state,
        cleanupFailure:
          failure.length <= MAX_STOP_CLEANUP_FAILURE_LENGTH
            ? failure
            : `${failure.slice(0, MAX_STOP_CLEANUP_FAILURE_LENGTH - 1)}…`,
      },
    });
  }
}

export const finalizeStopping = internalMutation({
  args: { turnId: v.id("scoutTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await finalizeStoppingTurn(ctx, args.turnId);
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
