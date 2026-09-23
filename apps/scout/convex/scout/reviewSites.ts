import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { mutation } from "../functions";
import { requireSessionPermission } from "../tasks/access";
import { siteHostnameSchema } from "../../shared/site";
import { syncChatSite } from "./siteListings";
import { attachSiteResearch } from "../tasks/siteResearchRecords";
import { publicResearchHostnameSchema } from "../tasks/siteResearchSources";
import { getInitialCheck } from "../tasks/requestChecks";

export const set = mutation({
  access: "access_review",
  args: { threadId: v.string(), site: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!chat || chat.userId !== ctx.viewer.userId || chat.purpose.kind !== "review")
      throw new Error("Review not found");
    await ctx.db.patch(chat._id, { primarySite: siteHostnameSchema.parse(args.site) });
    await syncChatSite(ctx, chat);
    return null;
  },
});

export const identify = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), site: v.string() },
  returns: v.object({ primarySite: v.string() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.active || (session.state.kind !== "running" && session.state.kind !== "starting"))
      throw new Error("This session is no longer running");
    const chat = await requireSessionPermission(ctx, session);
    if (
      !chat ||
      chat.purpose.kind !== "review" ||
      chat.runtime?.kind !== "agents_api" ||
      chat.runtime.sessionId !== session._id ||
      chat.userId !== session.userId
    )
      throw new Error("Review not found");
    const check = await getInitialCheck(ctx, session._id);
    if (check?.state.kind !== "completed" || check.state.result.decision.kind !== "approved")
      throw new Error("Site research requires an approved request");
    const site = siteHostnameSchema.parse(args.site);
    const primarySite = publicResearchHostnameSchema.parse(chat.primarySite ?? site);
    if (!chat.primarySite) {
      await ctx.db.patch(chat._id, { primarySite });
      await syncChatSite(ctx, chat);
    }
    await attachSiteResearch(ctx, primarySite, session.userId, session._id);
    return { primarySite };
  },
});
