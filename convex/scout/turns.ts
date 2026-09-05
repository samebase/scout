import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import {
  failHumanHandoffForTurn,
  signalHumanHandoffScoutPaused,
  stopHumanHandoffForTurn,
} from "../humanHandoffsModel";
import { omitNullish } from "../../shared/omitNullish";
import { scoutAgent } from "./agent";
import { browserReadyForTransfer } from "./chatAccess";
import { failPendingModelCall } from "./modelCalls";
import { scoutTokenUsageValidator } from "./models";
import type { ScoutModel, ScoutTokenUsage } from "./models";
import { scoutTurnWorkflow } from "./turnWorkflow";

export const TURN_START_TIMEOUT_MS = 5 * 60 * 1_000;
export const TURN_RUN_TIMEOUT_MS = 11 * 60 * 1_000;
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
  const handoffOwnsBrowserCleanup = await failHumanHandoffForTurn(ctx, turn._id);
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", turn.threadId))
    .order("desc")
    .first();
  const cleanupSession =
    !handoffOwnsBrowserCleanup &&
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

type TurnReplacement = {
  prompt: string;
  model: ScoutModel;
};

export async function enqueueTurn(
  ctx: MutationCtx,
  args: {
    threadId: string;
    userId: Id<"users">;
    scoutId: Id<"scouts">;
    prompt: string;
    model: ScoutModel;
  },
) {
  const { messageId, message } = await scoutAgent.saveMessage(ctx, {
    threadId: args.threadId,
    userId: args.userId,
    prompt: args.prompt,
    skipEmbeddings: true,
  });
  const leaseExpiresAt = Date.now() + TURN_START_TIMEOUT_MS;
  const turnId = await ctx.db.insert("scoutTurns", {
    threadId: args.threadId,
    order: message.order,
    promptMessageId: messageId,
    scoutId: args.scoutId,
    model: args.model,
    startedAt: Date.now(),
    skillsSelected: false,
    state: { kind: "pending", leaseExpiresAt, completedSteps: 0, usage: {} },
  });
  await scoutTurnWorkflow.start(
    ctx,
    internal.scout.turnLifecycle.run,
    {
      threadId: args.threadId,
      userId: args.userId,
      promptMessageId: messageId,
      model: args.model,
    },
    {
      startAsync: true,
      onComplete: internal.scout.turnLifecycle.onComplete,
      context: { turnId },
    },
  );
  await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, { turnId });
  return turnId;
}

export async function stopTurn(
  ctx: MutationCtx,
  turn: Doc<"scoutTurns">,
  replacement?: TurnReplacement,
) {
  if (turn.state.kind !== "pending" && turn.state.kind !== "completed") return false;
  await stopHumanHandoffForTurn(ctx, turn._id);
  const stopRequestedAt = Date.now();
  const usage = turn.state.usage;
  await ctx.db.patch(turn._id, {
    state: {
      kind: "stopping",
      stopRequestedAt,
      generationFinished: turn.state.kind === "completed",
      ...omitNullish({ replacement }),
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

async function browserNeededByReplacement(
  ctx: MutationCtx,
  turn: Doc<"scoutTurns">,
  session: Doc<"scoutBrowserSessions"> | null,
) {
  if (
    turn.state.kind !== "stopping" ||
    !turn.state.replacement ||
    turn.state.cleanupFailure ||
    session?.lifecycle.kind !== "active" ||
    session.threadId !== turn.threadId ||
    session.scoutId !== turn.scoutId
  ) {
    return false;
  }
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_session_id", (q) => q.eq("sessionId", session._id))
    .unique();
  if (handoff) return false;
  return await browserReadyForTransfer(ctx, session._id);
}

export const beginBrowserCleanup = internalMutation({
  args: { turnId: v.id("scoutTurns"), sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(v.literal("preserve"), v.literal("close")),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get("scoutTurns", args.turnId);
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
    if (
      !turn ||
      !session ||
      turn.threadId !== session.threadId ||
      turn.scoutId !== session.scoutId
    ) {
      throw new Error("Browser cleanup does not match the Scout turn");
    }
    if (await browserNeededByReplacement(ctx, turn, session)) return "preserve";
    if (session.lifecycle.kind === "active") {
      await ctx.db.patch(session._id, {
        lifecycle: { ...session.lifecycle, kind: "closing", closingAtMs: Date.now() },
      });
    }
    return "close";
  },
});

export async function finalizeStoppingTurn(ctx: MutationCtx, turnId: Doc<"scoutTurns">["_id"]) {
  const turn = await ctx.db.get("scoutTurns", turnId);
  if (!turn || turn.state.kind !== "stopping" || !turn.state.generationFinished) return;
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", turn.threadId))
    .order("desc")
    .first();
  if (session?.lifecycle.kind === "closing") return;
  if (
    session?.lifecycle.kind === "active" &&
    !(await browserNeededByReplacement(ctx, turn, session))
  )
    return;
  if (turn.state.replacement) {
    await ctx.db.patch(turn._id, {
      state: {
        kind: "replacing",
        stoppedAt: Date.now(),
        replacement: turn.state.replacement,
        usage: turn.state.usage,
        ...omitNullish({
          firecrawlCredits: turn.state.firecrawlCredits,
          firecrawlDurationMs: turn.state.firecrawlDurationMs,
        }),
      },
    });
    await ctx.scheduler.runAfter(0, internal.scout.turns.dispatchReplacement, { turnId: turn._id });
    return;
  }
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
  if (await browserNeededByReplacement(ctx, turn, session)) {
    await finalizeStoppingTurn(ctx, turn._id);
    return;
  }
  if (session?.lifecycle.kind === "active" || session?.lifecycle.kind === "closing") {
    if (session.lifecycle.kind === "closing") {
      const handoff = await ctx.db
        .query("scoutHumanHandoffs")
        .withIndex("by_session_id", (q) => q.eq("sessionId", session._id))
        .unique();
      if (handoff) return;
    }
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

export const dispatchReplacement = internalMutation({
  args: { turnId: v.id("scoutTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get("scoutTurns", args.turnId);
    if (!turn || turn.state.kind !== "replacing") return null;
    const binding = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (query) => query.eq("threadId", turn.threadId))
      .unique();
    if (!binding || binding.scoutId !== turn.scoutId) {
      throw new Error("Stopped turn is missing its Scout chat binding");
    }
    await enqueueTurn(ctx, {
      threadId: turn.threadId,
      userId: binding.userId,
      scoutId: turn.scoutId,
      ...turn.state.replacement,
    });
    await ctx.db.patch(turn._id, {
      state: {
        kind: "stopped",
        stoppedAt: turn.state.stoppedAt,
        usage: turn.state.usage,
        ...omitNullish({
          firecrawlCredits: turn.state.firecrawlCredits,
          firecrawlDurationMs: turn.state.firecrawlDurationMs,
        }),
      },
    });
    return null;
  },
});

export const assertPending = internalQuery({
  args: { turnId: v.id("scoutTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get("scoutTurns", args.turnId);
    if (!turn || turn.state.kind !== "pending") {
      throw new Error("Scout turn is no longer running");
    }
    return null;
  },
});

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
