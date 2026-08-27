import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import schema from "../schema";
import { scoutRunEventValidator } from "./model";

const MAX_EVENTS_PER_RUN = 500;
const MAX_MISSION_LENGTH = 4_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_SCOUT_NAME_LENGTH = 100;
const PUBLIC_NOTE_EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PUBLIC_NOTE_URL = /https?:\/\//i;
const PUBLIC_NOTE_CODE = /\b\d{4,8}\b/;
const PUBLIC_NOTE_SECRET_ASSIGNMENT = /\b(?:cookie|session|token)\s*[:=]\s*\S+/i;

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

function publicNote(value: string, label: string) {
  const note = requiredText(value, label, MAX_NOTE_LENGTH);
  if (
    PUBLIC_NOTE_URL.test(note) ||
    PUBLIC_NOTE_EMAIL.test(note) ||
    PUBLIC_NOTE_CODE.test(note) ||
    PUBLIC_NOTE_SECRET_ASSIGNMENT.test(note)
  ) {
    throw new Error(`${label} must not contain URLs, email addresses, or verification codes`);
  }
  return note;
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

async function insertRun(
  ctx: MutationCtx,
  identity: { scoutName: string; scoutEmail: string },
  target: { targetUrl: string; mission: string },
) {
  const now = Date.now();
  const runId = await ctx.db.insert("scoutRuns", {
    scoutName: requiredText(identity.scoutName, "Scout name", MAX_SCOUT_NAME_LENGTH),
    scoutEmail: requiredText(identity.scoutEmail, "Scout email", 320),
    targetUrl: requiredUrl(target.targetUrl, "Target URL"),
    mission: requiredText(target.mission, "Mission", MAX_MISSION_LENGTH),
    status: { kind: "pending" },
    browser: { kind: "none" },
    createdAt: now,
    updatedAt: now,
  });
  await insertEvent(ctx, runId, { kind: "run_created" }, now);
  return runId;
}

export const create = internalMutation({
  args: {
    scoutName: v.string(),
    scoutEmail: v.string(),
    targetUrl: v.string(),
    mission: v.string(),
  },
  returns: v.id("scoutRuns"),
  handler: async (ctx, args) => await insertRun(ctx, args, args),
});

export const createWithLatestIdentity = internalMutation({
  args: {
    targetUrl: v.string(),
    mission: v.string(),
  },
  returns: v.id("scoutRuns"),
  handler: async (ctx, args) => {
    const latest = await ctx.db.query("scoutRuns").withIndex("by_created_at").order("desc").first();
    if (!latest) {
      throw new Error("Scout has no existing identity to reuse");
    }
    return await insertRun(ctx, latest, args);
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

export const scrapeBrowserStarted = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    scrapeId: v.string(),
    profileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind !== "none") {
      throw new Error("Scout run already has a browser session");
    }

    const now = Date.now();
    const profileName = requiredText(args.profileName, "Browser profile name", 100);
    await ctx.db.patch(args.runId, {
      status: { kind: "running" },
      browser: {
        kind: "scrape_active",
        scrapeId: requiredText(args.scrapeId, "Scrape ID", 100),
        profileName,
        startedAt: now,
        replayAvailable: false,
      },
      updatedAt: now,
    });
    await insertEvent(ctx, args.runId, { kind: "scrape_browser_started", profileName }, now);
    return null;
  },
});

export const scrapeInteractionRecorded = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    scrapeId: v.string(),
    replayAvailable: v.boolean(),
    step: v.union(
      v.object({
        kind: v.literal("prompt"),
        summary: v.string(),
        success: v.boolean(),
        durationMs: v.number(),
      }),
      v.object({
        kind: v.literal("code_fallback"),
        summary: v.string(),
        fallbackReason: v.string(),
        success: v.boolean(),
        durationMs: v.number(),
        exitCode: v.union(v.number(), v.null()),
        killed: v.boolean(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind !== "scrape_active" || run.browser.scrapeId !== args.scrapeId) {
      throw new Error("Scrape browser session does not belong to this Scout run");
    }

    const now = Date.now();
    const summary = publicNote(args.step.summary, "Browser step summary");
    if (args.step.kind === "prompt") {
      await insertEvent(
        ctx,
        args.runId,
        {
          kind: "browser_prompt_step",
          summary,
          success: args.step.success,
          durationMs: args.step.durationMs,
        },
        now,
      );
    } else {
      await insertEvent(
        ctx,
        args.runId,
        {
          kind: "browser_code_fallback",
          summary,
          fallbackReason: publicNote(args.step.fallbackReason, "Code fallback reason"),
          success: args.step.success,
          durationMs: args.step.durationMs,
          exitCode: args.step.exitCode,
          killed: args.step.killed,
        },
        now,
      );
    }

    await ctx.db.patch(args.runId, {
      browser: {
        ...run.browser,
        replayAvailable: run.browser.replayAvailable || args.replayAvailable,
      },
      updatedAt: now,
    });
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
    if (run.browser.kind !== "active" && run.browser.kind !== "scrape_active") {
      throw new Error("A human can take over only while the browser is active");
    }

    const now = Date.now();
    const reason = publicNote(args.reason, "Human takeover reason");
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
    if (
      run.status.kind !== "needs_human" ||
      (run.browser.kind !== "active" && run.browser.kind !== "scrape_active")
    ) {
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
        summary: publicNote(args.summary, "Run summary"),
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
    const error = publicNote(args.error, "Run error");
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

export const scrapeBrowserStopped = internalMutation({
  args: {
    runId: v.id("scoutRuns"),
    scrapeId: v.string(),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
    replayAvailable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    if (run.browser.kind === "scrape_closed" && run.browser.scrapeId === args.scrapeId) {
      return null;
    }
    if (run.browser.kind !== "scrape_active" || run.browser.scrapeId !== args.scrapeId) {
      throw new Error("Scrape browser session does not belong to this Scout run");
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      browser: {
        kind: "scrape_closed",
        scrapeId: args.scrapeId,
        profileName: run.browser.profileName,
        closedAt: now,
        sessionDurationMs: args.sessionDurationMs,
        creditsBilled: args.creditsBilled,
        replayAvailable: run.browser.replayAvailable || args.replayAvailable,
      },
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      args.runId,
      {
        kind: "scrape_browser_stopped",
        sessionDurationMs: args.sessionDurationMs,
        creditsBilled: args.creditsBilled,
        replayAvailable: run.browser.replayAvailable || args.replayAvailable,
      },
      now,
    );
    return null;
  },
});

const benchmarkStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("needs_human"),
  v.literal("completed"),
  v.literal("failed"),
);

const benchmarkReportValidator = v.object({
  status: benchmarkStatusValidator,
  success: v.boolean(),
  wallTimeMs: v.number(),
  browserDurationMs: v.union(v.number(), v.null()),
  creditsBilled: v.union(v.number(), v.null()),
  promptCalls: v.number(),
  successfulPromptCalls: v.number(),
  failedPromptCalls: v.number(),
  codeFallbacks: v.number(),
  successfulCodeFallbacks: v.number(),
  failedCodeFallbacks: v.number(),
  legacyBrowserSteps: v.number(),
  humanInterventions: v.number(),
  publishedUrl: v.union(v.string(), v.null()),
  replayAvailable: v.boolean(),
});

export const benchmarkReport = internalQuery({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: benchmarkReportValidator,
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error("Scout run not found");
    }
    const events = await ctx.db
      .query("scoutRunEvents")
      .withIndex("by_run_id_and_created_at", (q) => q.eq("runId", args.runId))
      .order("asc")
      .take(MAX_EVENTS_PER_RUN);
    let promptCalls = 0;
    let successfulPromptCalls = 0;
    let codeFallbacks = 0;
    let successfulCodeFallbacks = 0;
    let legacyBrowserSteps = 0;
    let humanInterventions = 0;
    for (const { event } of events) {
      if (event.kind === "browser_prompt_step") {
        promptCalls += 1;
        successfulPromptCalls += Number(event.success);
      } else if (event.kind === "browser_code_fallback") {
        codeFallbacks += 1;
        successfulCodeFallbacks += Number(event.success);
      } else if (event.kind === "browser_step") {
        legacyBrowserSteps += 1;
      } else if (event.kind === "human_resumed") {
        humanInterventions += 1;
      }
    }
    const browserDurationMs =
      run.browser.kind === "closed" || run.browser.kind === "scrape_closed"
        ? run.browser.sessionDurationMs
        : null;
    const creditsBilled =
      run.browser.kind === "closed" || run.browser.kind === "scrape_closed"
        ? run.browser.creditsBilled
        : null;

    return {
      status: run.status.kind,
      success: run.status.kind === "completed",
      wallTimeMs: run.updatedAt - run.createdAt,
      browserDurationMs,
      creditsBilled,
      promptCalls,
      successfulPromptCalls,
      failedPromptCalls: promptCalls - successfulPromptCalls,
      codeFallbacks,
      successfulCodeFallbacks,
      failedCodeFallbacks: codeFallbacks - successfulCodeFallbacks,
      legacyBrowserSteps,
      humanInterventions,
      publishedUrl: run.status.kind === "completed" ? run.status.resultUrl : null,
      replayAvailable:
        (run.browser.kind === "scrape_active" || run.browser.kind === "scrape_closed") &&
        run.browser.replayAvailable,
    };
  },
});
