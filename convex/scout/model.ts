import { v } from "convex/values";

export const scoutRunStatusValidator = v.union(
  v.object({
    kind: v.literal("pending"),
  }),
  v.object({
    kind: v.literal("running"),
  }),
  v.object({
    kind: v.literal("needs_human"),
    reason: v.string(),
    requestedAt: v.number(),
  }),
  v.object({
    kind: v.literal("completed"),
    resultUrl: v.string(),
    summary: v.string(),
    completedAt: v.number(),
  }),
  v.object({
    kind: v.literal("failed"),
    error: v.string(),
    failedAt: v.number(),
  }),
);

export const scoutBrowserStateValidator = v.union(
  v.object({
    kind: v.literal("none"),
  }),
  v.object({
    kind: v.literal("active"),
    sessionId: v.string(),
    liveViewUrl: v.string(),
    interactiveLiveViewUrl: v.string(),
    expiresAt: v.string(),
  }),
  v.object({
    kind: v.literal("closed"),
    sessionId: v.string(),
    closedAt: v.number(),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
);

export const scoutRunEventValidator = v.union(
  v.object({
    kind: v.literal("run_created"),
  }),
  v.object({
    kind: v.literal("browser_started"),
    expiresAt: v.string(),
  }),
  v.object({
    kind: v.literal("browser_step"),
    summary: v.string(),
    success: v.boolean(),
    exitCode: v.union(v.number(), v.null()),
    killed: v.boolean(),
  }),
  v.object({
    kind: v.literal("mail_checked"),
    messageCount: v.number(),
  }),
  v.object({
    kind: v.literal("human_requested"),
    reason: v.string(),
  }),
  v.object({
    kind: v.literal("human_resumed"),
  }),
  v.object({
    kind: v.literal("run_completed"),
    resultUrl: v.string(),
  }),
  v.object({
    kind: v.literal("run_failed"),
    error: v.string(),
  }),
  v.object({
    kind: v.literal("browser_stopped"),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
);
