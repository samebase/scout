import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../functions";
import { requireViewerPermission } from "../access";
import { startSession } from "../tasks/sessions";
import { requireSessionPermission } from "../tasks/access";
import { chatPermission, requireRunnableThread } from "./chatAccess";
import { chatPurposeValidator, chatVisibilityValidator, productKindValidator } from "./chatModel";
import { playStepValidator } from "./play";
import { syncChatSite } from "./siteListings";

export const startProductChat = mutation({
  access: "access_account",
  args: {
    kind: productKindValidator,
    scoutId: v.id("scouts"),
    prompt: v.string(),
    visibility: chatVisibilityValidator,
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const purpose: typeof chatPurposeValidator.type =
      args.kind === "play" ? { kind: "play", step: null } : { kind: "review" };
    requireViewerPermission(ctx.viewer, chatPermission(purpose));
    const userId = ctx.viewer.userId;
    const sessionId = await startSession(ctx, {
      userId,
      scoutId: args.scoutId,
      prompt: args.prompt,
      engine: "agents_api",
    });
    await ctx.db.insert("scoutChats", {
      runtime: { kind: "agents_api", sessionId },
      threadId: sessionId,
      userId,
      scoutId: args.scoutId,
      createdAt: Date.now(),
      purpose,
      visibility: args.visibility,
      publicSiteEligible: false,
    });
    return { threadId: sessionId };
  },
});

export const setVisibility = mutation({
  access: "access_account",
  args: { threadId: v.string(), visibility: chatVisibilityValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!chat || chat.userId !== ctx.viewer.userId || chat.purpose.kind === "general")
      throw new Error("Chat not found");
    if (args.visibility === "public") await requireRunnableThread(ctx, args.threadId);
    await ctx.db.patch(chat._id, { visibility: args.visibility });
    await syncChatSite(ctx, chat);
    return null;
  },
});

export const setTaskActivityStep = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), step: playStepValidator },
  returns: v.null(),
  handler: async (ctx, { sessionId, step }) => {
    const session = await ctx.db.get(sessionId);
    if (
      !session ||
      !session.active ||
      (session.state.kind !== "running" && session.state.kind !== "starting")
    )
      throw new Error("This session is no longer running");
    const chat = await requireSessionPermission(ctx, session);
    if (
      !chat ||
      chat.purpose.kind !== "play" ||
      chat.runtime?.kind !== "agents_api" ||
      chat.runtime.sessionId !== sessionId ||
      chat.userId !== session.userId ||
      chat.scoutId !== session.scoutId
    )
      throw new Error("Play chat not found");
    if (chat.purpose.step !== step) {
      await ctx.db.patch(chat._id, { purpose: { kind: "play", step } });
    }
    return null;
  },
});
