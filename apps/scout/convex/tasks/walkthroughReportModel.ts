import { v } from "convex/values";
import { convexUsage } from "./convexAgentModel";
import { walkthroughContent } from "./screenshotModel";

export const walkthroughReportFinished = v.union(
  v.object({
    kind: v.literal("completed"),
    finishedAt: v.number(),
    response: v.string(),
    usage: v.union(convexUsage, v.null()),
    report: walkthroughContent,
  }),
  v.object({
    kind: v.literal("failed"),
    finishedAt: v.number(),
    response: v.union(v.string(), v.null()),
    usage: v.union(convexUsage, v.null()),
    error: v.string(),
  }),
);

export const walkthroughReporting = v.object({
  startedAt: v.number(),
  model: v.string(),
  billable: v.boolean(),
  request: v.string(),
  state: v.union(v.object({ kind: v.literal("running") }), walkthroughReportFinished),
});
