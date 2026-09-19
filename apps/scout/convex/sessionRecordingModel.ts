import { v } from "convex/values";

export const sessionRecordingConsent = v.object({
  enabled: v.boolean(),
  version: v.string(),
  updatedAt: v.number(),
  source: v.union(v.literal("signup"), v.literal("settings")),
  lastGrant: v.optional(
    v.object({
      version: v.string(),
      grantedAt: v.number(),
      source: v.union(v.literal("signup"), v.literal("settings")),
    }),
  ),
});
