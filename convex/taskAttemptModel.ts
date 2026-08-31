import { v } from "convex/values";

export const taskBrowserProfileSelectionValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), scoutId: v.id("scouts") }),
);

export const taskBrowserProfileValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), profileName: v.string() }),
);
