import { v } from "convex/values";
import { outdent } from "outdent";
import { internalMutation } from "../_generated/server";
import { mutation } from "../functions";
import { requireViewerPermission } from "../access";
import { startSession, stopSession } from "../tasks/sessions";
import { canAccess } from "../../shared/accessModel";
import { taskSelection } from "../../shared/taskModels";
import { requireSessionPermission } from "../tasks/access";
import { chatPermission, requireRunnableThread } from "./chatAccess";
import { chatPurposeValidator, chatVisibilityValidator } from "./chatModel";
import { playStepValidator } from "./play";
import { accessibleSite, syncChatSite } from "./siteListings";
import { siteHostnameSchema } from "../../shared/site";
import { omitNullish } from "../../shared/omitNullish";

export const startProductChat = mutation({
  access: "access_account",
  args: {
    product: v.union(
      v.object({ kind: v.literal("review"), site: v.optional(v.string()) }),
      v.object({ kind: v.literal("play") }),
    ),
    scoutId: v.id("scouts"),
    prompt: v.string(),
    visibility: chatVisibilityValidator,
    selection: taskSelection,
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const purpose: typeof chatPurposeValidator.type =
      args.product.kind === "play" ? { kind: "play", step: null } : { kind: "review" };
    requireViewerPermission(ctx.viewer, chatPermission(purpose));
    const userId = ctx.viewer.userId;
    const primarySite =
      args.product.kind === "review" && args.product.site !== undefined
        ? siteHostnameSchema.parse(args.product.site)
        : null;
    if (primarySite) {
      if (!(await accessibleSite(ctx, primarySite, ctx.viewer))) throw new Error("Site not found");
      if (!args.prompt.trim()) throw new Error("Enter a task for this site");
    }
    const prompt = primarySite
      ? outdent`
          Use https://${primarySite}/ as the main site for this task.

          ${args.prompt}
        `
      : args.prompt;
    const sessionId = await startSession(ctx, {
      userId,
      scoutId: args.scoutId,
      prompt,
      selection: args.selection,
    });
    await ctx.db.patch(userId, {
      lastScoutId: args.scoutId,
      lastTaskEngine: args.selection.engine,
      ...omitNullish({
        lastConvexModel:
          args.selection.engine === "convex_agent" ? args.selection.model : undefined,
      }),
    });
    const chatId = await ctx.db.insert("scoutChats", {
      runtime: { kind: "agents_api", sessionId },
      threadId: sessionId,
      userId,
      scoutId: args.scoutId,
      createdAt: Date.now(),
      purpose,
      visibility: args.visibility,
      publicSiteEligible: false,
      ...omitNullish({ primarySite }),
    });
    if (primarySite) {
      const chat = await ctx.db.get(chatId);
      if (!chat) throw new Error("Created task not found");
      await syncChatSite(ctx, chat);
    }
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
    const admin = canAccess("access_lab", ctx.viewer.accessKeys);
    if (!chat || (!admin && chat.userId !== ctx.viewer.userId) || chat.purpose.kind === "general")
      throw new Error("Chat not found");
    if (args.visibility === "public" && !admin) await requireRunnableThread(ctx, args.threadId);
    await ctx.db.patch(chat._id, { visibility: args.visibility });
    await syncChatSite(ctx, chat);
    return null;
  },
});

export const remove = mutation({
  access: "access_account",
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
      .unique();
    if (!chat) return null;
    if (chat.userId !== ctx.viewer.userId && !canAccess("access_lab", ctx.viewer.accessKeys))
      throw new Error("Task not found");
    if (chat.runtime?.kind !== "agents_api" || chat.purpose.kind === "general")
      throw new Error("Task not found");
    const session = await ctx.db.get(chat.runtime.sessionId);
    if (!session) throw new Error("Session not found");
    await stopSession(ctx, session, { kind: "stopped" });
    await ctx.db.delete(chat._id);
    await syncChatSite(ctx, chat);
    console.info("Task removed", { threadId, userId: ctx.viewer.userId });
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
