import { v } from "convex/values";
import { internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { requireAppUser } from "../access";
import { activeBrowserForChat, requireOwnedAgentThread, scoutIsWorking } from "./chatAccess";

async function requireManualThread(ctx: QueryCtx | MutationCtx, threadId: string) {
  const userId = await requireAppUser(ctx);
  await requireOwnedAgentThread(ctx, threadId, userId);
  const binding = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (query) => query.eq("threadId", threadId))
    .unique();
  if (!binding || binding.userId !== userId) {
    throw new Error("Chat not found");
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
    browserSessionId: v.union(v.id("scoutBrowserSessions"), v.null()),
    providerSessionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { scout, userId } = await requireManualThread(ctx, args.threadId);
    if (await scoutIsWorking(ctx, scout._id))
      throw new Error("Scout is already working or waiting for human help");
    const activeSession = await activeBrowserForChat(ctx, scout._id, args.threadId);
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
