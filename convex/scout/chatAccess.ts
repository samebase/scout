import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { scoutAgent } from "./agent";

type AgentThreadContext = QueryCtx | MutationCtx | ActionCtx;

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
  const pending = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "pending"),
    )
    .first();
  if (pending) return true;
  const pausedTurn = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (q) =>
      q.eq("scoutId", scoutId).eq("state.kind", "completed"),
    )
    .order("desc")
    .first();
  if (!pausedTurn) return false;
  const handoff = await ctx.db
    .query("scoutHumanHandoffs")
    .withIndex("by_turn_id", (q) => q.eq("turnId", pausedTurn._id))
    .unique();
  return (
    handoff?.status === "available" ||
    handoff?.status === "active" ||
    handoff?.status === "continued"
  );
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
