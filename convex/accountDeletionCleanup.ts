import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { authEmailRateLimitKey } from "./authEmail";
import { EMAIL_VERIFICATION_PROVIDER_ID, PASSWORD_RESET_PROVIDER_ID } from "../shared/auth";
import { finalizeStoppingTurn, stopTurn } from "./scout/turns";
import { omitNullish } from "../shared/omitNullish";

const BATCH_SIZE = 64;

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

async function deleteRateLimit(ctx: MutationCtx, identifier: string) {
  const row = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", identifier))
    .unique();
  if (row) await ctx.db.delete(row._id);
}

async function deleteSessionChildren(ctx: MutationCtx, sessionId: Id<"authSessions">) {
  const verifiers = await ctx.db
    .query("authVerifiers")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .take(BATCH_SIZE);
  for (const row of verifiers) await ctx.db.delete(row._id);
  if (verifiers.length === BATCH_SIZE) return false;
  const tokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .take(BATCH_SIZE);
  for (const row of tokens) await ctx.db.delete(row._id);
  return tokens.length < BATCH_SIZE;
}

export const authBatch = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("authSessions"),
    phase: v.union(v.literal("other_sessions"), v.literal("accounts")),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, sessionId, phase }) => {
    const user = await ctx.db.get("users", userId);
    if (user?.state !== "deleting") throw new Error("Account is not deleting");
    if (phase === "other_sessions") {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .take(2);
      const session = sessions.find((row) => row._id !== sessionId);
      if (!session) return true;
      if (await deleteSessionChildren(ctx, session._id)) await ctx.db.delete(session._id);
      return false;
    }
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .first();
    if (account) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .take(BATCH_SIZE);
      for (const code of codes) await ctx.db.delete(code._id);
      if (codes.length === BATCH_SIZE) return false;
      await deleteRateLimit(ctx, account._id);
      if (account.emailVerified) await deleteRateLimit(ctx, account.emailVerified);
      if (account.phoneVerified) await deleteRateLimit(ctx, account.phoneVerified);
      await ctx.db.delete(account._id);
      return false;
    }
    if (user.email) {
      await deleteRateLimit(ctx, user.email);
      for (const provider of [EMAIL_VERIFICATION_PROVIDER_ID, PASSWORD_RESET_PROVIDER_ID]) {
        const key = await authEmailRateLimitKey(provider, user.email);
        const row = await ctx.db
          .query("authEmailRateLimits")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique();
        if (row) await ctx.db.delete(row._id);
      }
    }
    if (user.phone) await deleteRateLimit(ctx, user.phone);
    return true;
  },
});

export const finish = internalMutation({
  args: { userId: v.id("users"), sessionId: v.id("authSessions") },
  returns: v.boolean(),
  handler: async (ctx, { userId, sessionId }) => {
    const user = await ctx.db.get("users", userId);
    if (user?.state !== "deleting") throw new Error("Account is not deleting");
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .first();
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(2);
    if (account || sessions.some((row) => row._id !== sessionId))
      throw new Error("Authentication cleanup is incomplete");
    const session = await ctx.db.get("authSessions", sessionId);
    if (session && session.userId !== userId) throw new Error("Invalid account cleanup session");
    if (!(await deleteSessionChildren(ctx, sessionId))) return false;
    if (session) await ctx.db.delete(session._id);
    await ctx.db.replace("users", userId, { state: "deleted", deletedAt: Date.now() });
    return true;
  },
});
