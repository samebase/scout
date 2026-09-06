import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { MAX_BROWSER_OPERATIONS } from "../browserModel";
import { scoutAgent } from "./agent";
import { requireUserPermission } from "../access";

export async function requireLabThread(ctx: Pick<QueryCtx, "db">, threadId: string) {
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();
  if (!chat) throw new Error("Chat not found");
  await requireUserPermission(ctx, chat.userId, "access_lab");
  return chat;
}

type AgentThreadContext = QueryCtx | MutationCtx | ActionCtx;

export async function browserReadyForTransfer(
  ctx: QueryCtx,
  sessionId: Id<"scoutBrowserSessions">,
) {
  const operations = await ctx.db
    .query("scoutBrowserOperations")
    .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", sessionId))
    .take(MAX_BROWSER_OPERATIONS);
  return operations.every(
    ({ state }) =>
      state.kind !== "prepared" &&
      (state.kind !== "indeterminate_after_dispatch" || state.executionFinished === true),
  );
}

export async function requireOwnedAgentThread(
  ctx: AgentThreadContext,
  threadId: string,
  userId: string,
) {
  const thread = await scoutAgent.getThreadMetadata(ctx, { threadId });
  if (thread.userId !== userId) {
    throw new Error("Thread not found");
  }
  return thread;
}

export async function scoutIsWorking(ctx: QueryCtx, scoutId: Id<"scouts">) {
  return (await scoutActivity(ctx, scoutId)).kind !== "idle";
}

export async function scoutActivity(ctx: QueryCtx, scoutId: Id<"scouts">) {
  const pending = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "pending"),
    )
    .first();
  if (pending) {
    return { kind: "running" as const, threadId: pending.threadId, turnId: pending._id };
  }
  const stopping = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "stopping"),
    )
    .first();
  if (stopping) {
    return stopping.state.kind === "stopping" && stopping.state.cleanupFailure
      ? {
          kind: "stopping" as const,
          threadId: stopping.threadId,
          turnId: stopping._id,
          retryable: true as const,
          failure: stopping.state.cleanupFailure,
        }
      : {
          kind: "stopping" as const,
          threadId: stopping.threadId,
          turnId: stopping._id,
          retryable: false as const,
        };
  }
  const replacing = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "replacing"),
    )
    .first();
  if (replacing) {
    return {
      kind: "stopping" as const,
      threadId: replacing.threadId,
      turnId: replacing._id,
      retryable: true as const,
    };
  }
  const pausedTurn = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "completed"),
    )
    .order("desc")
    .first();
  if (!pausedTurn) return { kind: "idle" as const };
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_turn_id", (q) => q.eq("turnId", pausedTurn._id))
    .unique();
  return handoff?.status === "available" ||
    handoff?.status === "active" ||
    handoff?.status === "continued"
    ? {
        kind: "handoff" as const,
        threadId: pausedTurn.threadId,
        turnId: pausedTurn._id,
      }
    : { kind: "idle" as const };
}

export async function activeBrowserForChat(ctx: QueryCtx, scoutId: Id<"scouts">, threadId: string) {
  const closingSession = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
      q.eq("scoutId", scoutId).eq("lifecycle.kind", "closing"),
    )
    .first();
  if (closingSession) {
    throw new Error("This Scout's browser is closing. Wait for cleanup to finish.");
  }
  const session = await ctx.db
    .query("scoutBrowserSessions")
    .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
      q.eq("scoutId", scoutId).eq("lifecycle.kind", "active"),
    )
    .first();
  if (session && session.threadId !== threadId) {
    throw new Error("This Scout has an open browser in another chat. Close it there first.");
  }
  if (session) {
    const handoff = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_session_id", (q) => q.eq("sessionId", session._id))
      .unique();
    if (handoff)
      throw new Error("This browser is reserved for human handoff until cleanup finishes.");
  }
  return session;
}
