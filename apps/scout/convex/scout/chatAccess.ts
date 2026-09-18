import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireUserPermission, type ViewerAccess } from "../access";
import { canAccess } from "../../shared/accessModel";
import { getInitialCheck } from "../tasks/requestChecks";

export async function isPublicChat(ctx: Pick<QueryCtx, "db">, chat: Doc<"scoutChats">) {
  if (chat.visibility !== "public") return false;
  if (chat.runtime?.kind !== "agents_api") return true;
  const check = await getInitialCheck(ctx, chat.runtime.sessionId);
  return check?.state.kind === "completed" && check.state.result.decision.kind === "approved";
}

export function chatPermission(purpose: Doc<"scoutChats">["purpose"]) {
  switch (purpose.kind) {
    case "general":
      return "access_lab";
    case "play":
      return "access_play";
    case "review":
      return "access_review";
  }
}

export async function visibleChat(
  ctx: Pick<QueryCtx, "db">,
  threadId: string,
  viewer: ViewerAccess,
) {
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();
  if (!chat) return null;
  const owner = viewer.kind === "account" && viewer.userId === chat.userId;
  if (chat.purpose.kind === "general") {
    return owner && canAccess("access_lab", viewer.accessKeys) ? chat : null;
  }
  return owner || (await isPublicChat(ctx, chat)) ? chat : null;
}

export async function requireRunnableThread(ctx: Pick<QueryCtx, "db">, threadId: string) {
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();
  if (!chat) throw new Error("Chat not found");
  await requireUserPermission(ctx, chat.userId, chatPermission(chat.purpose));
  return chat;
}

export async function scoutIsWorking(ctx: QueryCtx, scoutId: Id<"scouts">) {
  const experiment = await ctx.db
    .query("agentsApiSessions")
    .withIndex("by_scout_id_and_active", (q) => q.eq("scoutId", scoutId).eq("active", true))
    .first();
  if (experiment) return true;
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
