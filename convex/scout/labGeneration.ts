"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount, type LanguageModelUsage } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, internalAction } from "../_generated/server";
import { SCOUT_AGENT_INSTRUCTIONS, scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import { diagnosticMessage } from "./lib/redaction";
import { scoutLanguageModel, scoutModelValidator, type ScoutTokenUsage } from "./models";

const MAX_GENERATION_STEPS = 24;
const CLAIM_TEST_CLOSE_STEP = 18;
const CLAIM_TEST_FINAL_STEP = 19;
const AGENT_MAIL_CLOSE_TIMEOUT_MS = 1_000;

type LabBrowser = ReturnType<typeof createLabBrowserHarness>;
type LabBrowserUsage = Awaited<ReturnType<LabBrowser["close"]>>;
type GenerationResult =
  | { kind: "completed"; usage: ScoutTokenUsage }
  | { kind: "failed"; error: unknown };

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
      ? `${diagnosticMessage(generationResult.error)}; browser cleanup: ${diagnosticMessage(cleanupFailure)}`
      : cleanupFailure
        ? `Browser cleanup failed: ${diagnosticMessage(cleanupFailure)}`
        : diagnosticMessage(terminalError);

  return generationResult.kind === "completed"
    ? { failure, terminalError, usage: generationResult.usage }
    : { failure, terminalError };
}

export async function closeGenerationBrowser(browser: Pick<LabBrowser, "close"> | undefined) {
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

export function scoutWebsiteIdentityInstructions(
  scout: Pick<Doc<"scouts">, "displayName" | "websiteIdentity" | "agentMail">,
) {
  return `This Lab thread is bound to a Scout with first name ${JSON.stringify(scout.websiteIdentity.firstName)}, last name ${JSON.stringify(scout.websiteIdentity.lastName)}, display name ${JSON.stringify(scout.displayName)}, and email address ${JSON.stringify(scout.agentMail.address)}. Use only that identity for website accounts and email evidence in this thread.`;
}

function requireSecret(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function tokenUsage(usage: LanguageModelUsage): ScoutTokenUsage {
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
    const started = await ctx.runMutation(internal.scout.lab.startGeneration, {
      promptMessageId: args.promptMessageId,
    });
    if (!started) {
      return null;
    }

    let agentMailClient: MCPClient | undefined;
    let browser: LabBrowser | undefined;
    let generationResult: GenerationResult;

    try {
      await requireOwnedAgentThread(ctx, args.threadId, args.userId);
      const scoutId = await ctx.runQuery(internal.scout.lab.getThreadScoutId, {
        threadId: args.threadId,
        userId: args.userId,
      });
      const scout = await ctx.runQuery(internal.scout.scouts.getRuntimeIdentity, { scoutId });
      if (!scout || scout.status !== "active") {
        throw new Error("Active Scout not found");
      }
      const isClaimTestGeneration: boolean = await ctx.runQuery(
        internal.claimTests.isClaimTestGeneration,
        { promptMessageId: args.promptMessageId },
      );
      browser = createLabBrowserHarness({
        ...(isClaimTestGeneration ? {} : { profileName: scout.firecrawl.profileName }),
        onSessionAvailable: async (sessionId) => {
          return await ctx.runMutation(internal.claimTests.setBrowserSession, {
            promptMessageId: args.promptMessageId,
            sessionId,
          });
        },
        onOperationPrepared: async ({ action, toolCallId }) =>
          await ctx.runMutation(internal.claimTests.prepareBrowserOperation, {
            promptMessageId: args.promptMessageId,
            toolCallId,
            action,
          }),
        onOperationSettled: async ({ toolCallId, outcome }) => {
          await ctx.runMutation(internal.claimTests.settleBrowserOperation, {
            promptMessageId: args.promptMessageId,
            toolCallId,
            outcome,
          });
        },
        onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
          await ctx.runMutation(internal.claimTests.closeBrowserSessionRecord, {
            promptMessageId: args.promptMessageId,
            providerDurationMs: sessionDurationMs,
            creditsBilled,
          });
        },
        onLiveViewAvailable: async (liveViewUrl) => {
          await ctx.runMutation(internal.claimTests.setLiveView, {
            promptMessageId: args.promptMessageId,
            liveViewUrl,
          });
        },
        onLiveViewClosed: async () => {
          await ctx.runMutation(internal.claimTests.clearLiveView, {
            promptMessageId: args.promptMessageId,
          });
        },
      });
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

      const tools = {
        ...browser.tools,
        ...agentMailTools,
      };
      const instructions = `${SCOUT_AGENT_INSTRUCTIONS}\n\n${scoutWebsiteIdentityInstructions(scout)}${
        isClaimTestGeneration
          ? "\n\nThis claim test starts in a fresh browser profile with no saved website login. Treat that clean state as part of the evidence."
          : ""
      }`;
      const streamResult = await scoutAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: scoutLanguageModel(args.model),
          instructions,
          tools,
          stopWhen: isStepCount(MAX_GENERATION_STEPS),
          ...(isClaimTestGeneration
            ? {
                prepareStep: ({ stepNumber }: { stepNumber: number }) => {
                  if (stepNumber === CLAIM_TEST_CLOSE_STEP) {
                    return {
                      activeTools: ["browser_close"] as const,
                      toolChoice: { type: "tool", toolName: "browser_close" } as const,
                    };
                  }
                  if (stepNumber >= CLAIM_TEST_FINAL_STEP) {
                    return {
                      activeTools: [] as const,
                      toolChoice: "none" as const,
                      instructions: `${instructions}\n\nThe bounded browser phase is over. Do not investigate further. Give the final claim verdict now, beginning with the required Verdict line.`,
                    };
                  }
                  return undefined;
                },
              }
            : {}),
        },
        {
          saveStreamDeltas: {
            returnImmediately: true,
            chunking: "word",
            throttleMs: 100,
          },
        },
      );
      await streamResult.consumeStream();
      generationResult = {
        kind: "completed",
        usage: tokenUsage(await streamResult.totalUsage),
      };
    } catch (error) {
      generationResult = { kind: "failed", error };
    }

    let browserUsage: LabBrowserUsage = undefined;
    let cleanupFailure: unknown;
    try {
      browserUsage = await closeGenerationBrowser(browser);
    } catch (error) {
      cleanupFailure = error;
    }
    let completionFailure: unknown;
    if (generationResult.kind === "completed" && !cleanupFailure) {
      try {
        await ctx.runMutation(internal.scout.lab.completeGeneration, {
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
      await ctx.runMutation(internal.scout.lab.failGeneration, {
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
