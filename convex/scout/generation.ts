"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount, type LanguageModelUsage } from "ai";
import { v } from "convex/values";
import { inspect } from "node:util";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env, internalAction } from "../_generated/server";
import { findActiveBrowserSession } from "../humanHandoffBrowser";
import { scoutAgent } from "./agent";
import { createAccountTools } from "./accountTools";
import { requireOwnedAgentThread } from "./chatAccess";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { createHumanHandoffTool, type HumanHandoffCallbacks } from "./humanHandoffTool";
import {
  createHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
  humanHandoffOrigin,
  humanHandoffUrl,
} from "./lib/humanHandoffAccess";
import { scoutLanguageModel, scoutModelValidator, type ScoutTokenUsage } from "./models";
import { compactBrowserModelContext } from "./browserContext";
import { createToolArgumentProbe } from "./toolArgumentProbe";
import { repairStringifiedToolInput } from "./toolCallRepair";
import { scoutRuntimeInstructions } from "./runtimeInstructions";
import { createWebTools } from "./webTools";

const MAX_GENERATION_STEPS = 30;
const AGENT_MAIL_CLOSE_TIMEOUT_MS = 1_000;

type Browser = ReturnType<typeof createBrowserHarness>;
type BrowserUsage = Awaited<ReturnType<Browser["close"]>>;
type GenerationResult =
  | { kind: "completed"; usage: ScoutTokenUsage }
  | { kind: "failed"; error: unknown; usage?: ScoutTokenUsage };

export function generationFailureDetails(
  generationResult: GenerationResult,
  cleanupFailure: unknown,
  completionFailure: unknown,
) {
  const terminalError =
    generationResult.kind === "failed"
      ? generationResult.error
      : (cleanupFailure ?? completionFailure);
  const failure =
    generationResult.kind === "failed" && cleanupFailure
      ? `${generationErrorDetails(generationResult.error)}\nbrowser cleanup: ${generationErrorDetails(cleanupFailure)}`
      : cleanupFailure
        ? `Browser cleanup failed: ${generationErrorDetails(cleanupFailure)}`
        : generationErrorDetails(terminalError);

  return generationResult.usage === undefined
    ? { failure, terminalError }
    : { failure, terminalError, usage: generationResult.usage };
}

export function generationErrorDetails(error: unknown) {
  if (typeof error === "string") return error;
  return inspect(error, {
    depth: 3,
    maxStringLength: null,
  });
}

export function createStreamErrorCapture() {
  let captured: { error: unknown } | null = null;
  return {
    onError: (event: { error: unknown }) => {
      captured ??= { error: event.error };
    },
    throwIfCaptured: () => {
      if (captured) throw captured.error;
    },
  };
}

export async function closeGenerationBrowser(browser: Pick<Browser, "close"> | undefined) {
  return browser ? await browser.close() : undefined;
}

export async function closeAgentMailBestEffort(
  client: Pick<MCPClient, "close"> | undefined,
  timeoutMs = AGENT_MAIL_CLOSE_TIMEOUT_MS,
) {
  if (!client) return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    try {
      void client.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

function requireSecret(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function tokenUsage(usage: LanguageModelUsage): ScoutTokenUsage {
  const rawCost = usage.raw?.["cost"];
  return {
    ...(usage.inputTokens === undefined ? {} : { promptTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { completionTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(usage.outputTokenDetails.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
    ...(usage.inputTokenDetails.cacheReadTokens === undefined
      ? {}
      : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
    ...(typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
      ? { costUsd: rawCost }
      : {}),
  };
}

function addOptionalNumbers(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

export function addScoutTokenUsage(
  total: ScoutTokenUsage | undefined,
  next: ScoutTokenUsage,
): ScoutTokenUsage {
  if (total === undefined) return next;
  const promptTokens = addOptionalNumbers(total.promptTokens, next.promptTokens);
  const completionTokens = addOptionalNumbers(total.completionTokens, next.completionTokens);
  const totalTokens = addOptionalNumbers(total.totalTokens, next.totalTokens);
  const reasoningTokens = addOptionalNumbers(total.reasoningTokens, next.reasoningTokens);
  const cachedInputTokens = addOptionalNumbers(total.cachedInputTokens, next.cachedInputTokens);
  const costUsd = addOptionalNumbers(total.costUsd, next.costUsd);
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    promptMessageId: v.string(),
    model: scoutModelValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.scout.turns.start, {
      promptMessageId: args.promptMessageId,
    });
    if (!started) {
      return null;
    }
    let agentMailClient: MCPClient | undefined;
    let browser: Browser | undefined;
    let browserSessionId: Id<"scoutBrowserSessions"> | null = null;
    let interactiveLiveViewUrl: string | null = null;
    let humanHandoffWaiting = false;
    let generationResult: GenerationResult;
    let accumulatedUsage: ScoutTokenUsage | undefined;

    try {
      await requireOwnedAgentThread(ctx, args.threadId, args.userId);
      const runtimeContext = await ctx.runQuery(internal.scout.chats.runtimeContext, {
        promptMessageId: args.promptMessageId,
      });
      if (runtimeContext.userId !== args.userId) throw new Error("Scout turn owner is invalid");
      const scoutId = runtimeContext.scoutId;
      const scout = await ctx.runQuery(internal.scout.scouts.getRuntimeIdentity, { scoutId });
      if (!scout || scout.status !== "active") {
        throw new Error("Active Scout not found");
      }
      const runtimeCredentials = await ctx.runQuery(
        internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
        { scoutId },
      );
      const runtimeServiceAccounts = await ctx.runQuery(
        internal.scout.serviceAccounts.listRuntimeForScout,
        { scoutId },
      );
      browser = createBrowserHarness({
        profileName: scout.firecrawl.profileName,
        onSessionAvailable: async (providerSessionId) => {
          const registered = await ctx.runMutation(internal.scout.browserSessions.open, {
            threadId: args.threadId,
            scoutId,
            providerSessionId,
            profileName: scout.firecrawl.profileName,
          });
          browserSessionId = registered.sessionId;
          return { captureOperations: registered.captureOperations };
        },
        onOperationPrepared: async ({ action, toolCallId }) => {
          if (!browserSessionId) throw new Error("Browser session was not registered");
          return await ctx.runMutation(internal.scout.browserSessions.prepareOperation, {
            sessionId: browserSessionId,
            toolCallId,
            action,
          });
        },
        onOperationSettled: async ({ toolCallId, outcome }) => {
          if (!browserSessionId) throw new Error("Browser session was not registered");
          await ctx.runMutation(internal.scout.browserSessions.settleOperation, {
            sessionId: browserSessionId,
            toolCallId,
            outcome,
          });
        },
        onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
          if (!browserSessionId) return;
          await ctx.runMutation(internal.scout.browserSessions.close, {
            sessionId: browserSessionId,
            providerDurationMs: sessionDurationMs,
            creditsBilled,
          });
          browserSessionId = null;
        },
        onLiveViewAvailable: async (liveViewUrl) => {
          if (!browserSessionId) return;
          await ctx.runMutation(internal.scout.browserSessions.setLiveView, {
            sessionId: browserSessionId,
            liveViewUrl,
          });
        },
        onInteractiveLiveViewAvailable: async (url) => {
          interactiveLiveViewUrl = url;
        },
        onLiveViewClosed: async () => {
          interactiveLiveViewUrl = null;
          if (!browserSessionId) return;
          await ctx.runMutation(internal.scout.browserSessions.clearLiveView, {
            sessionId: browserSessionId,
          });
        },
      });
      if (runtimeContext.providerSessionId && runtimeContext.browserSessionId) {
        const existing = await findActiveBrowserSession(runtimeContext.providerSessionId);
        if (existing) {
          await browser.attach({ providerSessionId: existing.sessionId, cdpUrl: existing.cdpUrl });
          interactiveLiveViewUrl = existing.interactiveLiveViewUrl;
        } else {
          await ctx.runMutation(internal.scout.browserSessions.close, {
            sessionId: runtimeContext.browserSessionId,
            providerDurationMs: null,
            creditsBilled: null,
          });
        }
      }
      requireSecret(env.FIRECRAWL_API_KEY, "FIRECRAWL_API_KEY");
      agentMailClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.agentmail.to/mcp",
          headers: {
            "x-api-key": requireSecret(env.AGENTMAIL_API_KEY, "AGENTMAIL_API_KEY"),
          },
        },
      });
      const agentMailTools = selectAgentMailTools(
        await agentMailClient.tools(),
        scout.agentMail.inboxId,
      );
      const activeBrowser = browser;
      if (!activeBrowser) throw new Error("Browser harness was not initialized");
      const humanHandoffCallbacks: HumanHandoffCallbacks<Id<"scoutHumanHandoffs">> = {
        request: async (reason) => {
          if (!interactiveLiveViewUrl) {
            throw new Error("The current browser session has no interactive human-takeover link");
          }
          const accessToken = createHumanHandoffAccessToken();
          const request = await ctx.runMutation(internal.humanHandoffs.request, {
            promptMessageId: args.promptMessageId,
            reason,
            accessTokenHash: hashHumanHandoffAccessToken(accessToken),
          });
          return {
            ...request,
            handoffUrl: humanHandoffUrl(
              humanHandoffOrigin(env.SITE_URL),
              request.handoffId,
              accessToken,
            ),
          };
        },
        failDelivery: async (handoffId) =>
          await ctx.runMutation(internal.humanHandoffs.failDelivery, { handoffId }),
        onWaiting: () => {
          humanHandoffWaiting = true;
        },
      };
      const accountTools = createAccountTools(ctx, {
        browser: activeBrowser,
        scoutId,
        credentials: runtimeCredentials,
        sessionId: () => browserSessionId,
      });
      const tools = {
        ...browser.tools,
        ...createWebTools(),
        ...agentMailTools,
        request_human_help: createHumanHandoffTool(humanHandoffCallbacks),
        ...accountTools,
        inspect_tool_arguments: createToolArgumentProbe(),
      };
      const instructions = scoutRuntimeInstructions({
        scout,
        credentials: runtimeCredentials,
        serviceAccounts: runtimeServiceAccounts,
        browserSessionOpen: browserSessionId !== null,
      });
      const streamErrors = createStreamErrorCapture();
      const streamResult = await scoutAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: scoutLanguageModel(args.model),
          instructions,
          tools,
          repairToolCall: repairStringifiedToolInput,
          stopWhen: isStepCount(MAX_GENERATION_STEPS),
          onError: streamErrors.onError,
          onStepEnd: ({ usage }) => {
            accumulatedUsage = addScoutTokenUsage(accumulatedUsage, tokenUsage(usage));
          },
          prepareStep: async ({ messages }) => ({
            messages: compactBrowserModelContext(messages),
            ...(humanHandoffWaiting
              ? {
                  activeTools: [] as const,
                  toolChoice: "none" as const,
                  instructions:
                    instructions +
                    "\n\nHuman help was requested. The browser remains open while you are paused. Briefly tell the user you will resume after they return control.",
                }
              : {}),
          }),
        },
        {
          saveStreamDeltas: {
            returnImmediately: true,
            chunking: "word",
            throttleMs: 100,
          },
          contextHandler: async (_ctx, { allMessages }) => compactBrowserModelContext(allMessages),
        },
      );
      await streamResult.consumeStream();
      streamErrors.throwIfCaptured();
      generationResult = {
        kind: "completed",
        usage: accumulatedUsage ?? tokenUsage(await streamResult.totalUsage),
      };
    } catch (error) {
      generationResult = {
        kind: "failed",
        error,
        ...(accumulatedUsage === undefined ? {} : { usage: accumulatedUsage }),
      };
    }

    const preserveBrowserForHandoff = generationResult.kind === "completed" && humanHandoffWaiting;
    let browserUsage: BrowserUsage = undefined;
    let cleanupFailure: unknown;
    if (!preserveBrowserForHandoff) {
      try {
        browserUsage = await closeGenerationBrowser(browser);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    let completionFailure: unknown;
    if (generationResult.kind === "completed" && !cleanupFailure && !completionFailure) {
      try {
        if (preserveBrowserForHandoff) {
          await ctx.runMutation(internal.scout.turns.completeHumanHandoffPause, {
            promptMessageId: args.promptMessageId,
            usage: generationResult.usage,
          });
        } else {
          await ctx.runMutation(internal.scout.turns.complete, {
            promptMessageId: args.promptMessageId,
            usage: generationResult.usage,
            ...(browserUsage?.creditsBilled === null || browserUsage?.creditsBilled === undefined
              ? {}
              : { firecrawlCredits: browserUsage.creditsBilled }),
            ...(browserUsage?.sessionDurationMs === null ||
            browserUsage?.sessionDurationMs === undefined
              ? {}
              : { firecrawlDurationMs: browserUsage.sessionDurationMs }),
          });
        }
        await closeAgentMailBestEffort(agentMailClient);
        return null;
      } catch (error) {
        completionFailure = error;
      }
    }

    const failureDetails = generationFailureDetails(
      generationResult,
      cleanupFailure,
      completionFailure,
    );
    let terminalError = failureDetails.terminalError;
    try {
      await ctx.runMutation(internal.scout.turns.fail, {
        promptMessageId: args.promptMessageId,
        failure: failureDetails.failure,
        ...("usage" in failureDetails ? { usage: failureDetails.usage } : {}),
        ...(browserUsage?.creditsBilled === null || browserUsage?.creditsBilled === undefined
          ? {}
          : { firecrawlCredits: browserUsage.creditsBilled }),
        ...(browserUsage?.sessionDurationMs === null ||
        browserUsage?.sessionDurationMs === undefined
          ? {}
          : { firecrawlDurationMs: browserUsage.sessionDurationMs }),
      });
    } catch (persistenceError) {
      terminalError = new AggregateError(
        [failureDetails.terminalError, persistenceError],
        "Generation failed and its failure state could not be recorded",
      );
    }
    await closeAgentMailBestEffort(agentMailClient);
    throw terminalError;
  },
});
