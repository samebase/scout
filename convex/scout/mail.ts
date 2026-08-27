import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { getInboxMessage, listInboxMessages } from "./lib/agentmail";
import { extractEmailLinks } from "./lib/emailLinks";
import {
  executeBrowserCode,
  executeScrapeInteractCode,
  type BrowserExecution,
  type ScrapeInteraction,
} from "./lib/firecrawl";

const executionValidator = v.object({
  success: v.boolean(),
  stdout: v.string(),
  result: v.string(),
  stderr: v.string(),
  exitCode: v.union(v.number(), v.null()),
  killed: v.boolean(),
  error: v.union(v.string(), v.null()),
});

function requireActiveBrowser(run: Doc<"scoutRuns">) {
  if (run.browser.kind !== "active" && run.browser.kind !== "scrape_active") {
    throw new Error("Scout run has no active browser session");
  }
  return run.browser;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function elementRef(value: string) {
  if (!/^@e\d+$/.test(value)) {
    throw new Error("Input ref must be an agent-browser element ref such as @e1");
  }
  return value;
}

function redactVerificationMaterial(value: string) {
  return value
    .replace(/https:\/\/\S+/gi, "[link redacted]")
    .replace(/\b\d{4,8}\b/g, "[code redacted]");
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

function browserExecution(interaction: ScrapeInteraction): BrowserExecution {
  return {
    success: interaction.success,
    stdout: interaction.stdout,
    result: interaction.result,
    stderr: interaction.stderr,
    exitCode: interaction.exitCode,
    killed: interaction.killed,
    error: interaction.error,
  };
}

async function recordSecretExecution(
  ctx: ActionCtx,
  runId: Doc<"scoutRuns">["_id"],
  browser: Extract<Doc<"scoutRuns">["browser"], { kind: "scrape_active" }>,
  summary: string,
  fallbackReason: string,
  execution: BrowserExecution,
  durationMs: number,
  replayAvailable: boolean,
) {
  await ctx.runMutation(internal.scout.runs.scrapeInteractionRecorded, {
    runId,
    scrapeId: browser.scrapeId,
    replayAvailable,
    step: {
      kind: "code_fallback",
      summary,
      fallbackReason,
      success: execution.success,
      durationMs,
      exitCode: execution.exitCode,
      killed: execution.killed,
    },
  });
}

async function requireRun(ctx: ActionCtx, runId: Doc<"scoutRuns">["_id"]) {
  const run = await ctx.runQuery(internal.scout.runs.get, { runId });
  if (!run) {
    throw new Error("Scout run not found");
  }
  return run;
}

export const list = internalAction({
  args: {
    runId: v.id("scoutRuns"),
  },
  returns: v.array(
    v.object({
      messageId: v.string(),
      from: v.string(),
      subject: v.string(),
      timestamp: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    const messages = await listInboxMessages(run.scoutEmail, new Date(run.createdAt).toISOString());
    await ctx.runMutation(internal.scout.runs.mailCheckRecorded, {
      runId: args.runId,
      messageCount: messages.length,
    });
    return messages.map((message) => ({
      ...message,
      subject: redactVerificationMaterial(message.subject),
    }));
  },
});

export const listLinks = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    messageId: v.string(),
  },
  returns: v.object({
    subject: v.string(),
    links: v.array(
      v.object({
        index: v.number(),
        host: v.string(),
        label: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    const message = await getInboxMessage(run.scoutEmail, args.messageId);
    return {
      subject: redactVerificationMaterial(message.subject),
      links: extractEmailLinks(message).map((link, index) => ({
        index,
        host: link.host,
        label: redactVerificationMaterial(link.label),
      })),
    };
  },
});

export const openLink = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    messageId: v.string(),
    linkIndex: v.number(),
  },
  returns: executionValidator,
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.linkIndex) || args.linkIndex < 0) {
      throw new Error("Link index must be a non-negative integer");
    }

    const run = await requireRun(ctx, args.runId);
    const browser = requireActiveBrowser(run);
    const message = await getInboxMessage(run.scoutEmail, args.messageId);
    const link = extractEmailLinks(message)[args.linkIndex];
    if (!link) {
      throw new Error("Email link not found");
    }

    const summary = `Opened a link from “${redactVerificationMaterial(message.subject).slice(0, 160)}”`;
    let execution: BrowserExecution;
    if (browser.kind === "active") {
      execution = await executeBrowserCode(
        browser.sessionId,
        `agent-browser open ${shellQuote(link.url)} && agent-browser wait --load domcontentloaded && agent-browser snapshot -i`,
        60,
      );
      await recordExecution(ctx, args.runId, summary, execution);
    } else {
      const startedAt = Date.now();
      const interaction = await executeScrapeInteractCode(
        browser.scrapeId,
        `await page.goto(${JSON.stringify(link.url)}); await page.waitForLoadState('domcontentloaded'); JSON.stringify({ opened: true, title: await page.title() });`,
        60,
      );
      execution = browserExecution(interaction);
      await recordSecretExecution(
        ctx,
        args.runId,
        browser,
        "Opened an emailed verification link",
        "The verification link had to stay inside the Convex mail helper",
        execution,
        Date.now() - startedAt,
        interaction.replayAvailable,
      );
    }
    return execution;
  },
});

export const fillVerificationCode = internalAction({
  args: {
    runId: v.id("scoutRuns"),
    messageId: v.string(),
    inputRef: v.optional(v.string()),
  },
  returns: executionValidator,
  handler: async (ctx, args) => {
    const run = await requireRun(ctx, args.runId);
    const browser = requireActiveBrowser(run);
    const message = await getInboxMessage(run.scoutEmail, args.messageId);
    const codes = [
      ...new Set(
        [...`${message.subject}\n${message.text}`.matchAll(/\b\d{4,8}\b/g)].map(
          (match) => match[0],
        ),
      ),
    ];
    if (codes.length !== 1) {
      throw new Error(`Expected one verification code in the email; found ${codes.length}`);
    }

    let execution: BrowserExecution;
    if (browser.kind === "active") {
      if (!args.inputRef) {
        throw new Error("Input ref is required for a standalone browser session");
      }
      execution = await executeBrowserCode(
        browser.sessionId,
        `agent-browser fill ${elementRef(args.inputRef)} ${shellQuote(codes[0])} && agent-browser snapshot -i`,
        60,
      );
      await recordExecution(ctx, args.runId, "Filled an emailed verification code", execution);
    } else {
      const startedAt = Date.now();
      const interaction = await executeScrapeInteractCode(
        browser.scrapeId,
        `const inputs = page.locator('input:visible'); const candidates = []; for (let index = 0; index < await inputs.count(); index += 1) { const input = inputs.nth(index); const description = [await input.getAttribute('autocomplete'), await input.getAttribute('name'), await input.getAttribute('placeholder'), await input.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase(); if (description.includes('code') || description.includes('otp') || description.includes('verification')) candidates.push(index); } if (candidates.length !== 1) throw new Error('Expected one visible verification code field'); await inputs.nth(candidates[0]).fill(${JSON.stringify(codes[0])}); JSON.stringify({ filled: true });`,
        60,
      );
      execution = browserExecution(interaction);
      await recordSecretExecution(
        ctx,
        args.runId,
        browser,
        "Filled an emailed verification code",
        "The emailed code had to stay inside the Convex mail helper",
        execution,
        Date.now() - startedAt,
        interaction.replayAvailable,
      );
    }
    return execution;
  },
});
