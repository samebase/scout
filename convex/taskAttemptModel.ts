import { v } from "convex/values";

export const taskAttemptStateValidator = v.union(
  v.object({ kind: v.literal("active") }),
  v.object({
    kind: v.literal("completed"),
    conclusion: v.string(),
    resolvedAt: v.number(),
  }),
  v.object({
    kind: v.literal("blocked"),
    conclusion: v.string(),
    resolvedAt: v.number(),
  }),
  v.object({
    kind: v.literal("abandoned"),
    conclusion: v.string(),
    resolvedAt: v.number(),
  }),
);

export const taskBrowserProfileSelectionValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), scoutId: v.id("scouts") }),
);

export const taskBrowserProfileValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), profileName: v.string() }),
);
