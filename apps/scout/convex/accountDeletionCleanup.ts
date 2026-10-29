import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { finalizeStoppingTurn, stopTurn } from "./scout/turns";
import { omitNullish } from "../shared/omitNullish";

const BATCH_SIZE = 64;

export const tasks = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    sessionIds: v.array(v.id("agentsApiSessions")),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("agentsApiSessions")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .paginate({ cursor, numItems: 32 });
    return {
      sessionIds: page.page.map((session) => session._id),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const stopTask = internalMutation({
  args: { userId: v.id("users"), sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, { userId, sessionId }) => {
    const user = await ctx.db.get(userId);
    const session = await ctx.db.get(sessionId);
    if (user?.state !== "deleting" || session?.userId !== userId)
      throw new Error("Invalid task cleanup target");
    if (!session.active) return false;
    await ctx.db.patch(sessionId, { state: { kind: "stopped" } });
    return true;
  },
});

export const chats = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ threadIds: v.array(v.string()), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("scoutChats")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", userId))
      .paginate({ cursor, numItems: 32 });
    return {
      threadIds: page.page.map((chat) => chat.threadId),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const stopChat = internalMutation({
  args: { userId: v.id("users"), threadId: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("ready") }),
    v.object({ kind: v.literal("waiting") }),
    v.object({ kind: v.literal("close_managed"), sessionId: v.id("agentsApiSessions") }),
    v.object({
      kind: v.literal("close_browser"),
      sessionId: v.id("scoutBrowserSessions"),
      turnId: v.union(v.id("scoutTurns"), v.null()),
    }),
  ),
  handler: async (ctx, { userId, threadId }) => {
    const user = await ctx.db.get("users", userId);
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
      .unique();
    if (user?.state !== "deleting" || chat?.userId !== userId)
      throw new Error("Invalid account cleanup target");
    const managedId = chat.runtime?.kind === "agents_api" ? chat.runtime.sessionId : null;
    if (managedId) {
      const managed = await ctx.db.get(managedId);
      if (!managed || managed.userId !== userId) throw new Error("Invalid managed cleanup target");
      if (!managed.active) return { kind: "ready" as const };
      await ctx.db.patch(managedId, { state: { kind: "stopped" } });
      return { kind: "close_managed" as const, sessionId: managedId };
    }
    let turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    const session = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    const browserOpen = session && session.lifecycle.kind !== "closed";
    if (turn?.state.kind === "pending" || (turn?.state.kind === "completed" && browserOpen)) {
      await stopTurn(ctx, turn);
      turn = await ctx.db.get("scoutTurns", turn._id);
    }
    if (turn?.state.kind === "replacing") {
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
    if (turn?.state.kind === "stopping") {
      if (turn.state.replacement) {
        const { replacement: _replacement, ...state } = turn.state;
        await ctx.db.patch(turn._id, { state });
      }
      if (!turn.state.generationFinished) {
        if (Date.now() - turn.state.stopRequestedAt > 12 * 60_000)
          throw new Error("Scout work has not stopped; retry account deletion");
        return { kind: "waiting" as const };
      }
      if (!browserOpen) await finalizeStoppingTurn(ctx, turn._id);
    }
    if (session && browserOpen) {
      if (session.lifecycle.kind === "active")
        await ctx.db.patch(session._id, {
          lifecycle: { ...session.lifecycle, kind: "closing", closingAtMs: Date.now() },
        });
      return { kind: "close_browser" as const, sessionId: session._id, turnId: turn?._id ?? null };
    }
    return { kind: "ready" as const };
  },
});

/**
Deletes the account's site listings in batches, then, in the transaction that marks the user
deleted, everything that Convex Auth keeps for the user: the accounts, sessions, and refresh tokens
of the core, the password, and the verified email. Every session ends, and the email address can
sign up again as a new account.
*/
export const finish = internalMutation({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (user?.state !== "deleting") throw new Error("Account is not deleting");
    const listings = await ctx.db
      .query("siteUserListings")
      .withIndex("by_user_id_and_hostname", (q) => q.eq("userId", userId))
      .take(BATCH_SIZE);
    for (const listing of listings) await ctx.db.delete(listing._id);
    if (listings.length === BATCH_SIZE) return false;
    await ctx.runMutation(components.auth.public.deleteUser, { userId });
    await ctx.runMutation(components.authPassword.public.deleteUser, { userId });
    await ctx.runMutation(components.authEmail.verifiedEmails.deleteUser, { userId });
    await ctx.db.replace("users", userId, { state: "deleted", deletedAt: Date.now() });
    return true;
  },
});
