import { v } from "convex/values";

export const SITE_RESEARCH_MODEL = "spark-2";
export const SITE_RESEARCH_MAX_CREDITS = 50;
export const SITE_RESEARCH_TIMEOUT_MS = 6 * 60_000;

export const siteProfile = v.object({
  name: v.string(),
  homepageUrl: v.string(),
  // Profiles saved before overview persistence still contain only the full brief.
  overview: v.optional(v.string()),
  brief: v.string(),
  researchedAt: v.number(),
});

export const researchFinishedState = v.union(
  v.object({
    kind: v.literal("completed"),
    finishedAt: v.number(),
    brief: v.string(),
    briefPath: v.string(),
    source: v.optional(
      v.object({
        researchId: v.id("agentsApiSiteResearch"),
        researchedAt: v.number(),
        reused: v.boolean(),
      }),
    ),
  }),
  v.object({ kind: v.literal("failed"), finishedAt: v.number(), error: v.string() }),
  v.object({ kind: v.literal("skipped"), finishedAt: v.number(), reason: v.string() }),
  v.object({ kind: v.literal("cancelled"), finishedAt: v.number() }),
);

const researchFields = v.object({
  site: v.union(v.string(), v.null()),
  model: v.string(),
  maxCredits: v.number(),
  jobId: v.union(v.string(), v.null()),
  requestPath: v.union(v.string(), v.null()),
  responsePath: v.union(v.string(), v.null()),
  credits: v.union(v.number(), v.null()),
  state: v.union(
    v.object({ kind: v.literal("running") }),
    v.object({
      kind: v.literal("waiting"),
      researchId: v.id("agentsApiSiteResearch"),
      reused: v.boolean(),
    }),
    researchFinishedState,
  ),
});

export const siteResearchRecord = v.union(
  researchFields.extend({ sessionId: v.id("agentsApiSessions") }),
  researchFields.extend({
    sessionId: v.null(),
    userId: v.id("users"),
    billable: v.optional(v.boolean()),
  }),
);

export const researchSummary = v.object({
  reportedCredits: v.union(v.number(), v.null()),
  status: v.union(
    v.literal("running"),
    v.literal("waiting"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("cancelled"),
  ),
});
