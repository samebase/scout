import { v } from "convex/values";
import { agentsApiUsageValidator } from "./cost";

export const SITE_RESEARCH_MODEL = "gpt-5.6-luna";

export const researchCall = v.object({
  name: v.string(),
  startedAt: v.number(),
  finishedAt: v.number(),
  requestPath: v.string(),
  responsePath: v.union(v.string(), v.null()),
  usage: v.union(agentsApiUsageValidator, v.null()),
  credits: v.union(v.number(), v.null()),
});

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
  calls: v.array(researchCall),
  state: v.union(v.object({ kind: v.literal("running") }), researchFinishedState),
});

export const researchSummary = v.object({
  modelCost: v.union(v.number(), v.null()),
  reportedCredits: v.number(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("cancelled"),
  ),
});
