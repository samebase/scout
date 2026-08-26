import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  closeBrowserSession,
  createBrowserSession,
  executeBrowserCode,
  type BrowserExecution,
} from "./lib/firecrawl";
import { requireEnv } from "./lib/http";

const MAX_BROWSER_CODE_LENGTH = 100_000;
const MAX_STEP_SUMMARY_LENGTH = 2_000;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 120;

const executionValidator = v.object({
  success: v.boolean(),
  stdout: v.string(),
  result: v.string(),
  stderr: v.string(),
  exitCode: v.union(v.number(), v.null()),
  killed: v.boolean(),
  error: v.union(v.string(), v.null()),
});

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

function timeoutSeconds(value: number) {
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `Timeout must be an integer from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}`,
    );
  }
  return value;
}

function requireActiveBrowser(run: Doc<"scoutRuns">) {
  if (run.browser.kind !== "active") {
    throw new Error("Scout run has no active browser session");
  }
  return run.browser;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function elementRef(value: string, label: string) {
  if (!/^@e\d+$/.test(value)) {
    throw new Error(`${label} must be an agent-browser element ref such as @e1`);
  }
  return value;
}

async function recordExecution(
  ctx: ActionCtx,
  runId: Doc<"scoutRuns">["_id"],
  summary: string,
  execution: BrowserExecution,
) {
  await ctx.runMutation(internal.scout.runs.browserStepRecorded, {
    runId,
    summary,
    success: execution.success,
    exitCode: execution.exitCode,
    killed: execution.killed,
  });
}

export const start = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.object({
    expiresAt: v.string(),
    execution: executionValidator,
  }),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    if (run.browser.kind !== "none") {
      throw new Error("Scout run already has a browser session");
    }

    const session = await createBrowserSession();
    try {
      await ctx.runMutation(internal.scout.runs.browserStarted, {
        runId: args.runId,
        ...session,
      });
    } catch (error) {
      await closeBrowserSession(session.sessionId).catch(() => undefined);
      throw error;
    }

    const execution = await executeBrowserCode(
      session.sessionId,
      `agent-browser open ${shellQuote(run.targetUrl)} && agent-browser wait --load domcontentloaded && agent-browser snapshot -i`,
      60,
    );
    await recordExecution(ctx, args.runId, `Opened ${new URL(run.targetUrl).host}`, execution);

    return { expiresAt: session.expiresAt, execution };
  },
});

export const execute = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    code: v.string(),
    summary: v.string(),
    timeoutSeconds: v.number(),
  },
  returns: executionValidator,
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireActiveBrowser(run);
    const code = requiredText(args.code, "Browser code", MAX_BROWSER_CODE_LENGTH);
    const summary = requiredText(args.summary, "Browser step summary", MAX_STEP_SUMMARY_LENGTH);
    const execution = await executeBrowserCode(
      browser.sessionId,
      code,
      timeoutSeconds(args.timeoutSeconds),
    );
    await recordExecution(ctx, args.runId, summary, execution);
    return execution;
  },
});

export const fillIdentity = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    nameRef: v.optional(v.string()),
    emailRef: v.optional(v.string()),
    passwordRef: v.optional(v.string()),
    passwordConfirmationRef: v.optional(v.string()),
  },
  returns: executionValidator,
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireActiveBrowser(run);
    const fields = [
      args.nameRef ? [elementRef(args.nameRef, "Name ref"), run.scoutName] : undefined,
      args.emailRef ? [elementRef(args.emailRef, "Email ref"), run.scoutEmail] : undefined,
      args.passwordRef
        ? [elementRef(args.passwordRef, "Password ref"), requireEnv("SCOUT_AGENT_PASSWORD")]
        : undefined,
      args.passwordConfirmationRef
        ? [
            elementRef(args.passwordConfirmationRef, "Password confirmation ref"),
            requireEnv("SCOUT_AGENT_PASSWORD"),
          ]
        : undefined,
    ].filter((field): field is [string, string] => field !== undefined);

    if (fields.length === 0) {
      throw new Error("At least one identity field is required");
    }

    const code = [
      ...fields.map(([ref, value]) => `agent-browser fill ${ref} ${shellQuote(value)}`),
      "agent-browser snapshot -i",
    ].join(" && ");
    const execution = await executeBrowserCode(browser.sessionId, code, 60);
    await recordExecution(ctx, args.runId, "Filled Scout identity fields", execution);
    return execution;
  },
});

export const stop = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.object({
    success: v.boolean(),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireActiveBrowser(run);
    const result = await closeBrowserSession(browser.sessionId);
    await ctx.runMutation(internal.scout.runs.browserStopped, {
      runId: args.runId,
      sessionId: browser.sessionId,
      sessionDurationMs: result.sessionDurationMs,
      creditsBilled: result.creditsBilled,
    });
    return result;
  },
});
