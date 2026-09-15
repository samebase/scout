import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../functions";
import schema from "../schema";
import { getInitialCheck } from "./requestChecks";
import { requireSessionPermission } from "./access";
import { estimateAgentsApiCost } from "./cost";
import {
  researchCall,
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
  const calls = research.calls.filter((call) => call.name === "selection" || call.name === "brief");
  const costs = calls.map(
    (call) =>
      estimateAgentsApiCost({
        model: research.model,
        usage: call.usage,
        webSearchCalls: 0,
        browsers: [],
        firecrawlUsdPerCredit: null,
        now: 0,
      }).modelEstimateUsd,
  );
  return {
    status: research.state.kind,
    modelCost:
      research.state.kind === "running" || costs.some((cost) => cost === null)
        ? null
        : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
    reportedCredits: research.calls.reduce((sum, call) => sum + (call.credits ?? 0), 0),
  };
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
    return ctx.db.insert("agentsApiSiteResearch", {
      sessionId: session._id,
      site: args.site,
      model: SITE_RESEARCH_MODEL,
      calls: [],
      state: { kind: "running" },
    });
  },
});

export const recordCall = internalMutation({
  args: { researchId: v.id("agentsApiSiteResearch"), call: researchCall },
  returns: v.null(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research) throw new Error("Site research not found");
    if (research.calls.length >= 6) throw new Error("Site research call limit exceeded");
    await ctx.db.patch(research._id, { calls: [...research.calls, args.call] });
    return null;
  },
});

export const finish = internalMutation({
  args: { researchId: v.id("agentsApiSiteResearch"), state: researchFinishedState },
  returns: v.null(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research || research.state.kind !== "running") return null;
    const session = await ctx.db.get(research.sessionId);
    await ctx.db.patch(research._id, {
      state:
        session?.state.kind === "starting" && session.active
          ? args.state
          : { kind: "cancelled", finishedAt: Date.now() },
    });
    return null;
  },
});
