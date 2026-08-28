import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  closeBrowserSession,
  closeScrapeInteractSession,
  createBrowserSession,
  createScrapeInteractSession,
  executeBrowserCode,
  executeScrapeInteractCode,
  executeScrapeInteractPrompt,
  type BrowserExecution,
  type ScrapeInteraction,
} from "./lib/firecrawl";
import { requireEnv } from "./lib/http";
import type { ScoutConnection } from "./scouts";

const MAX_BROWSER_CODE_LENGTH = 100_000;
const MAX_BROWSER_PROMPT_LENGTH = 2_000;
const MAX_STEP_SUMMARY_LENGTH = 2_000;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_SCRAPE_TIMEOUT_SECONDS = 300;
const LEGACY_SCRAPE_PROFILE_NAME = "scout-conrad";

const executionValidator = v.object({
  success: v.boolean(),
  stdout: v.string(),
  result: v.string(),
  stderr: v.string(),
  exitCode: v.union(v.number(), v.null()),
  killed: v.boolean(),
  error: v.union(v.string(), v.null()),
});

const scrapeExecutionValidator = v.object({
  success: v.boolean(),
  output: v.string(),
  exitCode: v.union(v.number(), v.null()),
  killed: v.boolean(),
  error: v.union(v.string(), v.null()),
  replayAvailable: v.boolean(),
  durationMs: v.number(),
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

function scrapeTimeoutSeconds(value: number) {
  if (
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_SECONDS ||
    value > MAX_SCRAPE_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `Timeout must be an integer from ${MIN_TIMEOUT_SECONDS} to ${MAX_SCRAPE_TIMEOUT_SECONDS}`,
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

function requireScrapeBrowser(run: Doc<"scoutRuns">) {
  if (run.browser.kind !== "scrape_active") {
    throw new Error("Scout run has no active scrape browser session");
  }
  return run.browser;
}

export function selectScrapeProfileName(connection: ScoutConnection | null) {
  return connection?.firecrawl.profileName ?? LEGACY_SCRAPE_PROFILE_NAME;
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

function sanitizedError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown browser error";
  return message
    .replace(/https:\/\/\S+/gi, "[URL redacted]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email redacted]")
    .replace(/\b\d{4,8}\b/g, "[code redacted]")
    .slice(0, MAX_STEP_SUMMARY_LENGTH);
}

function scrapeResult(interaction: ScrapeInteraction, durationMs: number, output: string) {
  return {
    success: interaction.success,
    output,
    exitCode: interaction.exitCode,
    killed: interaction.killed,
    error: interaction.error ? sanitizedError(interaction.error) : null,
    replayAvailable: interaction.replayAvailable,
    durationMs,
  };
}

function failedScrapeResult(error: unknown, durationMs: number) {
  return {
    success: false,
    output: "",
    exitCode: null,
    killed: false,
    error: sanitizedError(error),
    replayAvailable: false,
    durationMs,
  };
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

export const startScrapeInteract = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    if (run.browser.kind !== "none") {
      throw new Error("Scout run already has a browser session");
    }

    const connection = run.scoutId
      ? await ctx.runQuery(internal.scout.scouts.getConnections, { scoutId: run.scoutId })
      : null;
    const profileName = selectScrapeProfileName(connection);
    const session = await createScrapeInteractSession(run.targetUrl, profileName);
    try {
      await ctx.runMutation(internal.scout.runs.scrapeBrowserStarted, {
        runId: args.runId,
        scrapeId: session.scrapeId,
        profileName,
      });
    } catch (error) {
      await closeScrapeInteractSession(session.scrapeId).catch(() => undefined);
      throw error;
    }
    return { success: true };
  },
});

export const prompt = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    prompt: v.string(),
    summary: v.string(),
    timeoutSeconds: v.number(),
  },
  returns: scrapeExecutionValidator,
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireScrapeBrowser(run);
    const prompt = requiredText(args.prompt, "Browser prompt", MAX_BROWSER_PROMPT_LENGTH);
    const summary = requiredText(args.summary, "Browser step summary", MAX_STEP_SUMMARY_LENGTH);
    const timeout = scrapeTimeoutSeconds(args.timeoutSeconds);
    const startedAt = Date.now();

    let result: ReturnType<typeof scrapeResult>;
    try {
      const interaction = await executeScrapeInteractPrompt(browser.scrapeId, prompt, timeout);
      result = scrapeResult(interaction, Date.now() - startedAt, interaction.output);
    } catch (error) {
      result = failedScrapeResult(error, Date.now() - startedAt);
    }
    await ctx.runMutation(internal.scout.runs.scrapeInteractionRecorded, {
      runId: args.runId,
      scrapeId: browser.scrapeId,
      replayAvailable: result.replayAvailable,
      step: {
        kind: "prompt",
        summary,
        success: result.success,
        durationMs: result.durationMs,
      },
    });
    return result;
  },
});

export const executeScrapeFallback = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    code: v.string(),
    language: v.optional(v.union(v.literal("node"), v.literal("bash"))),
    summary: v.string(),
    fallbackReason: v.string(),
    timeoutSeconds: v.number(),
  },
  returns: scrapeExecutionValidator,
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireScrapeBrowser(run);
    const code = requiredText(args.code, "Browser code", MAX_BROWSER_CODE_LENGTH);
    const summary = requiredText(args.summary, "Browser step summary", MAX_STEP_SUMMARY_LENGTH);
    const fallbackReason = requiredText(
      args.fallbackReason,
      "Code fallback reason",
      MAX_STEP_SUMMARY_LENGTH,
    );
    const timeout = scrapeTimeoutSeconds(args.timeoutSeconds);
    const startedAt = Date.now();

    let result: ReturnType<typeof scrapeResult>;
    try {
      const interaction = await executeScrapeInteractCode(
        browser.scrapeId,
        code,
        timeout,
        args.language,
      );
      result = scrapeResult(
        interaction,
        Date.now() - startedAt,
        interaction.result || interaction.stdout,
      );
    } catch (error) {
      result = failedScrapeResult(error, Date.now() - startedAt);
    }
    await ctx.runMutation(internal.scout.runs.scrapeInteractionRecorded, {
      runId: args.runId,
      scrapeId: browser.scrapeId,
      replayAvailable: result.replayAvailable,
      step: {
        kind: "code_fallback",
        summary,
        fallbackReason,
        success: result.success,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        killed: result.killed,
      },
    });
    return result;
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

export const fillScrapeLoginIdentity = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: scrapeExecutionValidator,
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireScrapeBrowser(run);
    const email = JSON.stringify(run.scoutEmail);
    const password = JSON.stringify(requireEnv("SCOUT_AGENT_PASSWORD"));
    const code = `
const inputs = page.locator('input:visible');
const emailCandidates = [];
const passwordCandidates = [];
for (let index = 0; index < await inputs.count(); index += 1) {
  const input = inputs.nth(index);
  const type = (await input.getAttribute('type') || '').toLowerCase();
  const description = [
    await input.getAttribute('autocomplete'),
    await input.getAttribute('name'),
    await input.getAttribute('id'),
    await input.getAttribute('placeholder'),
    await input.getAttribute('aria-label'),
  ].filter(Boolean).join(' ').toLowerCase();
  if (type === 'password' || description.includes('password')) passwordCandidates.push(index);
  if (type === 'email' || description.includes('email') || description.includes('username')) {
    emailCandidates.push(index);
  }
}
if (emailCandidates.length > 1 || passwordCandidates.length > 1) {
  throw new Error('Expected at most one visible email field and one visible password field');
}
if (emailCandidates.length + passwordCandidates.length === 0) {
  throw new Error('No visible login identity fields were found');
}
if (emailCandidates.length === 1) await inputs.nth(emailCandidates[0]).fill(${email});
if (passwordCandidates.length === 1) await inputs.nth(passwordCandidates[0]).fill(${password});
JSON.stringify({ filled: true });`;
    const startedAt = Date.now();

    let result: ReturnType<typeof scrapeResult>;
    try {
      const interaction = await executeScrapeInteractCode(browser.scrapeId, code, 60);
      result = scrapeResult(
        interaction,
        Date.now() - startedAt,
        interaction.success ? "Identity fields filled" : "",
      );
    } catch (error) {
      result = failedScrapeResult(error, Date.now() - startedAt);
    }
    await ctx.runMutation(internal.scout.runs.scrapeInteractionRecorded, {
      runId: args.runId,
      scrapeId: browser.scrapeId,
      replayAvailable: result.replayAvailable,
      step: {
        kind: "code_fallback",
        summary: "Filled visible login identity fields",
        fallbackReason: "Login credentials had to stay inside the Convex secret helper",
        success: result.success,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        killed: result.killed,
      },
    });
    return result;
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

export const stopScrapeInteract = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.object({
    success: v.boolean(),
    sessionDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
    replayAvailable: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.scout.runs.get, { runId: args.runId });
    if (!run) {
      throw new Error("Scout run not found");
    }
    const browser = requireScrapeBrowser(run);
    const result = await closeScrapeInteractSession(browser.scrapeId);
    if (!result.success) {
      throw new Error("Firecrawl did not stop the scrape browser session");
    }
    await ctx.runMutation(internal.scout.runs.scrapeBrowserStopped, {
      runId: args.runId,
      scrapeId: browser.scrapeId,
      sessionDurationMs: result.sessionDurationMs,
      creditsBilled: result.creditsBilled,
      replayAvailable: result.replayAvailable,
    });
    return result;
  },
});
