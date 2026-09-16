import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ensureSite } from "../scout/siteListings";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../functions";
import schema from "../schema";
import { getInitialCheck } from "./requestChecks";
import { requireSessionPermission } from "./access";
import {
  SITE_RESEARCH_MAX_CREDITS,
  researchFinishedState,
  researchSummary,
  SITE_RESEARCH_MODEL,
} from "./siteResearchModel";

export function getResearch(ctx: Pick<QueryCtx, "db">, sessionId: Id<"agentsApiSessions">) {
  return ctx.db
    .query("agentsApiSiteResearch")
    .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
    .unique();
}

export const get = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.union(schema.doc("agentsApiSiteResearch"), v.null()),
  handler: (ctx, args) => getResearch(ctx, args.sessionId),
});

export function summarizeResearch(research: Doc<"agentsApiSiteResearch">) {
  return { status: research.state.kind, reportedCredits: research.credits };
}

export const inspect = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.union(schema.doc("agentsApiSiteResearch").extend(researchSummary.fields), v.null()),
  handler: async (ctx, args) => {
    const research = await getResearch(ctx, args.sessionId);
    if (!research) return null;
    return {
      ...research,
      ...summarizeResearch(research),
    };
  },
});

export const start = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), site: v.union(v.string(), v.null()) },
  returns: v.union(v.id("agentsApiSiteResearch"), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.state.kind !== "starting" || !session.active) return null;
    const chat = await requireSessionPermission(ctx, session);
    if (chat?.purpose.kind !== "review") return null;
    const check = await getInitialCheck(ctx, session._id);
    if (check?.state.kind !== "completed" || check.state.result.decision.kind !== "approved")
      throw new Error("Site research requires an approved request");
    if (await getResearch(ctx, session._id)) return null;
    if (args.site) {
      await ensureSite(ctx, args.site);
      await ctx.scheduler.runAfter(0, internal.scout.sitePreviews.ensure, { site: args.site });
    }
    return ctx.db.insert("agentsApiSiteResearch", {
      sessionId: session._id,
      site: args.site,
      model: SITE_RESEARCH_MODEL,
      maxCredits: SITE_RESEARCH_MAX_CREDITS,
      jobId: null,
      requestPath: null,
      responsePath: null,
      credits: null,
      state: { kind: "running" },
    });
  },
});

export const submitted = internalMutation({
  args: { researchId: v.id("agentsApiSiteResearch"), jobId: v.string(), requestPath: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research || research.jobId) throw new Error("Research job already submitted or missing");
    await ctx.db.patch(research._id, { jobId: args.jobId, requestPath: args.requestPath });
    const session = await ctx.db.get(research.sessionId);
    return session?.state.kind === "starting" && session.active;
  },
});

export const finish = internalMutation({
  args: {
    researchId: v.id("agentsApiSiteResearch"),
    state: researchFinishedState,
    responsePath: v.union(v.string(), v.null()),
    credits: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research || research.state.kind !== "running") return null;
    const session = await ctx.db.get(research.sessionId);
    let state = args.state;
    if (session?.state.kind === "failed")
      state = { kind: "failed", finishedAt: Date.now(), error: session.state.error };
    else if (session?.state.kind !== "starting" || !session.active)
      state = { kind: "cancelled", finishedAt: Date.now() };
    await ctx.db.patch(research._id, {
      responsePath: args.responsePath,
      credits: args.credits,
      state,
    });
    return null;
  },
});
