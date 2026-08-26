import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import schema from "../schema";
import { scoutRunEventValidator } from "./model";

const MAX_EVENTS_PER_RUN = 500;
const MAX_MISSION_LENGTH = 4_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_SCOUT_NAME_LENGTH = 100;

function requiredText(value: string, label: string, maximumLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`);
  }
  return trimmed;
}

function requiredUrl(value: string, label: string) {
  const trimmed = requiredText(value, label, 2_000);
  const url = new URL(trimmed);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return url.toString();
}

type ScoutRunEvent = Infer<typeof scoutRunEventValidator>;

async function requireRun(ctx: MutationCtx, runId: Id<"scoutRuns">) {
  const run = await ctx.db.get(runId);
  if (!run) {
    throw new Error("Scout run not found");
  }
  return run;
}

async function insertEvent(
  ctx: MutationCtx,
  runId: Id<"scoutRuns">,
  event: ScoutRunEvent,
  createdAt: number,
) {
  await ctx.db.insert("scoutRunEvents", {
    runId,
    event,
    createdAt,
  });
}

export const create = internalMutation({
  args: {
    scoutName: v.string(),
    scoutEmail: v.string(),
    targetUrl: v.string(),
    mission: v.string(),
  },
  returns: v.id("scoutRuns"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await ctx.db.insert("scoutRuns", {
      scoutName: requiredText(args.scoutName, "Scout name", MAX_SCOUT_NAME_LENGTH),
      scoutEmail: requiredText(args.scoutEmail, "Scout email", 320),
      targetUrl: requiredUrl(args.targetUrl, "Target URL"),
      mission: requiredText(args.mission, "Mission", MAX_MISSION_LENGTH),
      status: { kind: "pending" },
      browser: { kind: "none" },
      createdAt: now,
      updatedAt: now,
    });
    await insertEvent(ctx, runId, { kind: "run_created" }, now);
    return runId;
  },
});

export const get = internalQuery({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.union(schema.doc("scoutRuns"), v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.runId),
});

export const listEvents = internalQuery({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.array(schema.doc("scoutRunEvents")),
  handler: async (ctx, args) =>
    await ctx.db
      .query("scoutRunEvents")
      .withIndex("by_run_id_and_created_at", (q) => q.eq("runId", args.runId))
      .order("asc")
      .take(MAX_EVENTS_PER_RUN),
});

export const browserStarted = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    sessionId: v.string(),
    liveViewUrl: v.string(),
    interactiveLiveViewUrl: v.string(),
    expiresAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind !== "none") {
      throw new Error("Scout run already has a browser session");
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: { kind: "running" },
      browser: {
        kind: "active",
        sessionId: args.sessionId,
        liveViewUrl: requiredUrl(args.liveViewUrl, "Live view URL"),
        interactiveLiveViewUrl: requiredUrl(
          args.interactiveLiveViewUrl,
          "Interactive live view URL",
        ),
        expiresAt: requiredText(args.expiresAt, "Browser expiration", 100),
      },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "browser_started", expiresAt: args.expiresAt }, now);
    return null;
  },
});

export const browserStepRecorded = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    summary: v.string(),
    success: v.boolean(),
    exitCode: v.union(v.number(), v.null()),
    killed: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args.runId);
    const now = Date.now();
    await insertEvent(
      ctx,
      args.runId,
      {
        kind: "browser_step",
        summary: requiredText(args.summary, "Browser step summary", MAX_NOTE_LENGTH),
        success: args.success,
        exitCode: args.exitCode,
        killed: args.killed,
      },
      now,
    );
    await ctx.db.patch(args.runId, { updatedAt: now });
    return null;
  },
});

export const mailCheckRecorded = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    messageCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args.runId);
    const now = Date.now();
    await insertEvent(
      ctx,
      args.runId,
      { kind: "mail_checked", messageCount: args.messageCount },
      now,
    );
    await ctx.db.patch(args.runId, { updatedAt: now });
    return null;
  },
});

export const requestHuman = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind !== "active") {
      throw new Error("A human can take over only while the browser is active");
    }

    const now = Date.now();
    const reason = requiredText(args.reason, "Human takeover reason", MAX_NOTE_LENGTH);
    await ctx.db.patch(args.runId, {
      status: { kind: "needs_human", reason, requestedAt: now },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "human_requested", reason }, now);
    return null;
  },
});

export const resume = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.status.kind !== "needs_human" || run.browser.kind !== "active") {
      throw new Error("Scout run is not waiting for human takeover");
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: { kind: "running" },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "human_resumed" }, now);
    return null;
  },
});

export const complete = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    resultUrl: v.string(),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args.runId);
    const now = Date.now();
    const resultUrl = requiredUrl(args.resultUrl, "Result URL");
    await ctx.db.patch(args.runId, {
      status: {
        kind: "completed",
        resultUrl,
        summary: requiredText(args.summary, "Run summary", MAX_NOTE_LENGTH),
        completedAt: now,
      },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "run_completed", resultUrl }, now);
    return null;
  },
});

export const fail = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args.runId);
    const now = Date.now();
    const error = requiredText(args.error, "Run error", MAX_NOTE_LENGTH);
    await ctx.db.patch(args.runId, {
      status: { kind: "failed", error, failedAt: now },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "run_failed", error }, now);
    return null;
  },
});

export const browserStopped = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    sessionId: v.string(),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind === "closed" && run.browser.sessionId === args.sessionId) {
      return null;
    }
    if (run.browser.kind !== "active" || run.browser.sessionId !== args.sessionId) {
      throw new Error("Browser session does not belong to this Scout run");
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      browser: {
        kind: "closed",
        sessionId: args.sessionId,
        closedAt: now,
        sessionDurationMs: args.sessionDurationMs,
        creditsBilled: args.creditsBilled,
      },
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      args.runId,
      {
        kind: "browser_stopped",
        sessionDurationMs: args.sessionDurationMs,
        creditsBilled: args.creditsBilled,
      },
      now,
    );
    return null;
  },
});
