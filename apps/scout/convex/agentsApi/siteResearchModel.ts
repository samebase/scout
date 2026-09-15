import { v } from "convex/values";

export const SITE_RESEARCH_MODEL = "spark-2";
export const SITE_RESEARCH_MAX_CREDITS = 50;
export const SITE_RESEARCH_TIMEOUT_MS = 180_000;

export const researchFinishedState = v.union(
  v.object({
    kind: v.literal("completed"),
    finishedAt: v.number(),
    brief: v.string(),
    briefPath: v.string(),
  }),
  v.object({ kind: v.literal("failed"), finishedAt: v.number(), error: v.string() }),
  v.object({ kind: v.literal("skipped"), finishedAt: v.number(), reason: v.string() }),
  v.object({ kind: v.literal("cancelled"), finishedAt: v.number() }),
);

export const siteResearchRecord = v.object({
  sessionId: v.id("agentsApiSessions"),
  site: v.union(v.string(), v.null()),
  model: v.string(),
  maxCredits: v.number(),
  jobId: v.union(v.string(), v.null()),
  requestPath: v.union(v.string(), v.null()),
  responsePath: v.union(v.string(), v.null()),
  credits: v.union(v.number(), v.null()),
  state: v.union(v.object({ kind: v.literal("running") }), researchFinishedState),
});

export const researchSummary = v.object({
  reportedCredits: v.union(v.number(), v.null()),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("cancelled"),
  ),
});
