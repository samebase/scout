import { v } from "convex/values";
import { internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { requireAppUser } from "../access";
import { requireOwnedAgentThread } from "./labAccess";

async function requireManualThread(ctx: QueryCtx | MutationCtx, threadId: string) {
  const userId = await requireAppUser(ctx);
  await requireOwnedAgentThread(ctx, threadId, userId);
  const binding = await ctx.db
    .query("scoutLabThreads")
    .withIndex("by_thread_id", (query) => query.eq("threadId", threadId))
    .unique();
  if (!binding || binding.userId !== userId) {
    throw new Error("Lab thread not found");
  }
  const scout = await ctx.db.get(binding.scoutId);
  if (!scout || scout.status !== "active") {
    throw new Error("Active Scout not found");
  }
  return { binding, scout, userId };
}

export const runtimeContext = internalQuery({
  args: { threadId: v.string() },
  returns: v.object({
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    profileName: v.string(),
    inboxId: v.string(),
    browserSessionId: v.union(v.id("scoutLabBrowserSessions"), v.null()),
    providerSessionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { scout, userId } = await requireManualThread(ctx, args.threadId);
    const pendingTurn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_scout_id_and_state_kind", (query) =>
        query.eq("scoutId", scout._id).eq("state.kind", "pending"),
      )
      .first();
    if (pendingTurn?.state.kind === "pending" && pendingTurn.state.leaseExpiresAt > Date.now()) {
      throw new Error("Scout is already working");
    }
    const browserSession = await ctx.db
      .query("scoutLabBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (query) => query.eq("threadId", args.threadId))
      .order("desc")
      .first();
    if (browserSession && browserSession.scoutId !== scout._id) {
      throw new Error("Lab browser session has an invalid Scout binding");
    }
    const activeSession = browserSession?.lifecycle.kind === "active" ? browserSession : null;
    return {
      userId,
      scoutId: scout._id,
      profileName: scout.firecrawl.profileName,
      inboxId: scout.agentMail.inboxId,
      browserSessionId: activeSession?._id ?? null,
      providerSessionId: activeSession?.providerSessionId ?? null,
    };
  },
});
