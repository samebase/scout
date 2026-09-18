import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ensureSite, syncChatSite } from "../scout/siteListings";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../functions";
import schema from "../schema";
import { getInitialCheck } from "./requestChecks";
import { requireSessionPermission } from "./access";
import { siteHostnameSchema } from "../../shared/site";
import { researchSite } from "./siteResearchSources";
import {
  SITE_RESEARCH_MAX_CREDITS,
  researchFinishedState,
  SITE_RESEARCH_MODEL,
  siteProfile,
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

export const job = internalQuery({
  args: { researchId: v.id("agentsApiSiteResearch") },
  returns: v.union(schema.doc("agentsApiSiteResearch"), v.null()),
  handler: (ctx, args) => ctx.db.get(args.researchId),
});

export function summarizeResearch(research: Doc<"agentsApiSiteResearch">) {
  return { status: research.state.kind, reportedCredits: research.credits };
}

export const inspect = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.union(schema.doc("agentsApiSiteResearch"), v.null()),
  handler: (ctx, args) => getResearch(ctx, args.sessionId),
});

const emptyJob = {
  model: SITE_RESEARCH_MODEL,
  maxCredits: SITE_RESEARCH_MAX_CREDITS,
  jobId: null,
  requestPath: null,
  responsePath: null,
  credits: null,
};

async function startSiteResearch(ctx: MutationCtx, site: Doc<"sites">, userId: Id<"users">) {
  const researchId = await ctx.db.insert("agentsApiSiteResearch", {
    ...emptyJob,
    site: site.hostname,
    sessionId: null,
    userId,
    state: { kind: "running" },
  });
  await ctx.db.patch(site._id, { researchId });
  await ctx.scheduler.runAfter(0, internal.tasks.siteResearch.process, { researchId });
  await ctx.scheduler.runAfter(0, internal.scout.sitePreviews.ensure, { site: site.hostname });
  return researchId;
}

export async function ensureSiteResearch(ctx: MutationCtx, hostname: string, userId: Id<"users">) {
  if (researchSite(`https://${hostname}/`) !== hostname)
    throw new Error("Research requires a public hostname");
  const siteId = await ensureSite(ctx, hostname);
  const site = await ctx.db.get(siteId);
  if (!site) throw new Error("Site not found");
  return site.researchId
    ? { researchId: site.researchId, reused: true }
    : { researchId: await startSiteResearch(ctx, site, userId), reused: false };
}

export const currentSiteJob = internalQuery({
  args: { site: v.string() },
  returns: v.union(schema.doc("agentsApiSiteResearch"), v.null()),
  handler: async (ctx, args) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.site))
      .unique();
    if (!site) throw new Error("Site not found");
    return site.researchId ? ctx.db.get(site.researchId) : null;
  },
});

export const refresh = internalMutation({
  args: {
    site: v.string(),
    userId: v.id("users"),
    expectedResearchId: v.union(v.id("agentsApiSiteResearch"), v.null()),
  },
  returns: v.id("agentsApiSiteResearch"),
  handler: async (ctx, args) => {
    const hostname = siteHostnameSchema.parse(args.site);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
      .unique();
    if (!site) throw new Error("Site not found");
    if (site.researchId) {
      const current = await ctx.db.get(site.researchId);
      if (current?.state.kind === "running" || site.researchId !== args.expectedResearchId)
        return site.researchId;
    }
    return startSiteResearch(ctx, site, args.userId);
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
    const existing = await getResearch(ctx, session._id);
    if (existing) return existing._id;
    const hostname = chat.primarySite ?? args.site;
    if (!hostname)
      return ctx.db.insert("agentsApiSiteResearch", {
        ...emptyJob,
        sessionId: session._id,
        site: null,
        credits: 0,
        state: {
          kind: "skipped",
          finishedAt: Date.now(),
          reason: "No single public HTTPS site in the request.",
        },
      });
    if (!chat.primarySite) {
      await ctx.db.patch(chat._id, { primarySite: hostname });
      await syncChatSite(ctx, chat);
    }
    const { researchId, reused } = await ensureSiteResearch(ctx, hostname, session.userId);
    return ctx.db.insert("agentsApiSiteResearch", {
      ...emptyJob,
      sessionId: session._id,
      site: hostname,
      state: { kind: "waiting", researchId, reused },
    });
  },
});

export const submitted = internalMutation({
  args: { researchId: v.id("agentsApiSiteResearch"), jobId: v.string(), requestPath: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research || research.jobId) throw new Error("Research job already submitted or missing");
    if (research.state.kind !== "running") return false;
    await ctx.db.patch(research._id, { jobId: args.jobId, requestPath: args.requestPath });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    researchId: v.id("agentsApiSiteResearch"),
    jobId: v.union(v.string(), v.null()),
    state: researchFinishedState,
    responsePath: v.union(v.string(), v.null()),
    credits: v.union(v.number(), v.null()),
    profile: v.union(siteProfile, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const research = await ctx.db.get(args.researchId);
    if (!research || (research.state.kind !== "running" && research.state.kind !== "waiting"))
      return null;
    let state = args.state;
    if (research.sessionId !== null) {
      const session = await ctx.db.get(research.sessionId);
      if (session?.state.kind === "failed")
        state = { kind: "failed", finishedAt: Date.now(), error: session.state.error };
      else if (session?.state.kind !== "starting" || !session.active)
        state = { kind: "cancelled", finishedAt: Date.now() };
    } else if (state.kind === "completed") {
      if (!args.profile || !research.site)
        throw new Error("Completed site research requires its profile");
      const hostname = research.site;
      const site = await ctx.db
        .query("sites")
        .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
        .unique();
      if (!site || site.researchId !== research._id) throw new Error("Site research was replaced");
      await ctx.db.patch(site._id, { profile: args.profile });
    }
    await ctx.db.patch(research._id, {
      jobId: args.jobId,
      responsePath: args.responsePath,
      credits: args.credits,
      state,
    });
    return null;
  },
});
