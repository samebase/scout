"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import {
  asSchema,
  generateText,
  isStepCount,
  type FinishReason,
  type LanguageModelCallStartEvent,
  type LanguageModelCallEndEvent,
  type LanguageModelUsage,
} from "ai";
import { v } from "convex/values";
import { inspect } from "node:util";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import { scoutAgent } from "./agent";
import { createAccountTools, restoreManagedPasswordRedaction } from "./accountTools";
import { createAgentMailWriteTools } from "./agentMailTools";
import { requireOwnedAgentThread } from "./chatAccess";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { attachPersistedBrowserSession } from "./browserSessionConnection";
import { createHumanHandoffTool, type HumanHandoffCallbacks } from "./humanHandoffTool";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "./lib/agentMail";
import {
  deriveHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
} from "./lib/humanHandoffAccess";
import { omitNullish } from "../../shared/omitNullish";
import {
  addScoutTokenUsage,
  scoutLanguageModel,
  scoutModelValidator,
  type ScoutTokenUsage,
} from "./models";
import { compactBrowserModelContext, compactedBrowserSnapshotCount } from "./browserContext";
import { compactionThreshold, estimateContextTokens, SUMMARY_INSTRUCTIONS } from "./modelContext";
import { prepareConversationContext } from "./compactionContext";
import { createToolArgumentProbe } from "./toolArgumentProbe";
import { repairStringifiedToolInput } from "./toolCallRepair";
import { scoutRuntimeInstructions } from "./runtimeInstructions";
import { createWebTools } from "./webTools";

export const GENERATION_SLICE_STEPS = 1;
export const GENERATION_SLICE_WORK_BUDGET_MS = 6 * 60 * 1_000;
export const MAX_TURN_STEPS = 120;
export const MAX_TURN_DURATION_MS = 45 * 60 * 1_000;
const RECENT_MESSAGE_FETCH_LIMIT = 500;
const AGENT_MAIL_CLOSE_TIMEOUT_MS = 1_000;
const AGENT_MAIL_REQUEST_TIMEOUT_MS = 30_000;

type Browser = ReturnType<typeof createBrowserHarness>;
type GenerationResult =
  | { kind: "completed"; usage: ScoutTokenUsage }
  | { kind: "continued"; completedSteps: number; usage: ScoutTokenUsage }
  | { kind: "failed"; error: unknown; usage?: ScoutTokenUsage };
type GenerationSliceResult = { kind: "completed" } | { kind: "continued" };

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

  return {
    failure,
    terminalError,
    ...omitNullish({ usage: generationResult.usage }),
  };
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

async function loadAgentMailTools(client: MCPClient, abortSignal: AbortSignal) {
  let page = await client.listTools({
    options: { signal: abortSignal, timeout: AGENT_MAIL_REQUEST_TIMEOUT_MS },
  });
  const tools = [...page.tools];
  while (page.nextCursor != null) {
    page = await client.listTools({
      params: { cursor: page.nextCursor },
      options: { signal: abortSignal, timeout: AGENT_MAIL_REQUEST_TIMEOUT_MS },
    });
    tools.push(...page.tools);
  }
  return client.toolsFromDefinitions({ ...page, tools });
}

function requireSecret(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function tokenUsage(usage: LanguageModelUsage): ScoutTokenUsage {
  const rawCost = usage.raw?.["cost"];
  return omitNullish({
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    costUsd:
      typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : undefined,
  });
}

export function modelCallContext(event: LanguageModelCallStartEvent) {
  return JSON.stringify(
    {
      version: 1,
      instructions: event.instructions ?? null,
      messages: event.messages,
      tools: event.tools ?? null,
      settings: omitNullish({
        maxOutputTokens: event.maxOutputTokens,
        temperature: event.temperature,
        topP: event.topP,
        topK: event.topK,
        presencePenalty: event.presencePenalty,
        frequencyPenalty: event.frequencyPenalty,
        stopSequences: event.stopSequences,
        seed: event.seed,
        reasoning: event.reasoning,
      }),
    },
    null,
    2,
  );
}

export function generationNeedsContinuation(
  finishReason: FinishReason,
  sliceStepCount: number,
  completedSteps: number,
  sliceStepLimit: number,
) {
  return (
    finishReason === "tool-calls" &&
    sliceStepCount >= sliceStepLimit &&
    completedSteps + sliceStepCount < MAX_TURN_STEPS
  );
}

export function generationSliceTimeoutMs(
  actionStartedAt: number,
  turnStartedAt: number,
  now: number,
) {
  return Math.max(
    0,
    Math.min(
      GENERATION_SLICE_WORK_BUDGET_MS - (now - actionStartedAt),
      MAX_TURN_DURATION_MS - (now - turnStartedAt),
    ),
  );
}

export function finalStepToolsCompleted(step: {
  toolCalls: ReadonlyArray<{ toolCallId: string } | undefined>;
  content: ReadonlyArray<{ type: string; toolCallId?: string }>;
}) {
  const completed = new Set(
    step.content.flatMap((part) =>
      (part.type === "tool-result" || part.type === "tool-error") && part.toolCallId
        ? [part.toolCallId]
        : [],
    ),
  );
  return step.toolCalls.every(
    (toolCall) => toolCall !== undefined && completed.has(toolCall.toolCallId),
  );
}

function userMessageText(message: Parameters<typeof compactBrowserModelContext>[0][number]) {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function preserveTurnObjective(
  messages: Parameters<typeof compactBrowserModelContext>[0],
  objective: string,
) {
  if (messages.some((message) => userMessageText(message)?.trim() === objective)) return messages;
  return [{ role: "user" as const, content: objective }, ...messages];
}

export const runSlice = internalAction({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    promptMessageId: v.string(),
    model: scoutModelValidator,
  },
  returns: v.union(
    v.object({ kind: v.literal("completed") }),
    v.object({ kind: v.literal("continued") }),
  ),
  handler: async (ctx, args): Promise<GenerationSliceResult> => {
    const actionStartedAt = Date.now();
    const progress = await ctx.runMutation(internal.scout.turns.start, {
      promptMessageId: args.promptMessageId,
    });
    if (!progress) {
      return { kind: "completed" };
    }
    let agentMailClient: MCPClient | undefined;
    let browser: Browser | undefined;
    let browserSessionId: Id<"scoutBrowserSessions"> | null = null;
    let interactiveLiveViewUrl: string | null = null;
    let humanHandoffWaiting = false;
    let humanHandoffAccessToken: string | undefined;
    let generationResult: GenerationResult;
    let accumulatedUsage: ScoutTokenUsage | undefined;
    const previousUsage = progress.usage;
    let turnId: Id<"scoutTurns"> | undefined;

    try {
      await requireOwnedAgentThread(ctx, args.threadId, args.userId);
      const runtimeContext = await ctx.runQuery(internal.scout.chats.runtimeContext, {
        promptMessageId: args.promptMessageId,
      });
      const activeTurnId = runtimeContext.turnId;
      turnId = activeTurnId;
      const beforeModelToolDispatch = async () => {
        await ctx.runQuery(internal.scout.turns.assertPending, { turnId: activeTurnId });
      };
      if (runtimeContext.userId !== args.userId) throw new Error("Scout turn owner is invalid");
      if (Date.now() - runtimeContext.startedAt >= MAX_TURN_DURATION_MS) {
        throw new Error("Scout reached the 45-minute turn safety limit");
      }
      const initialSliceTimeoutMs = generationSliceTimeoutMs(
        actionStartedAt,
        runtimeContext.startedAt,
        Date.now(),
      );
      if (initialSliceTimeoutMs <= 0) {
        throw new Error("Scout ran out of time before the next model step could start");
      }
      const modelCallCaptureController = new AbortController();
      const sliceAbortSignal = AbortSignal.any([
        AbortSignal.timeout(initialSliceTimeoutMs),
        modelCallCaptureController.signal,
      ]);
      const sliceStepLimit = Math.min(
        GENERATION_SLICE_STEPS,
        MAX_TURN_STEPS - progress.completedSteps,
      );
      if (sliceStepLimit <= 0) {
        throw new Error(`Scout reached the ${MAX_TURN_STEPS}-step safety limit`);
      }
      const [promptMessage] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [args.promptMessageId],
      });
      const objective = promptMessage?.text?.trim();
      if (!objective) throw new Error("Scout turn objective not found");
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
        beforeDispatch: beforeModelToolDispatch,
        onSessionCreated: async (session) => {
          const registered = await ctx.runMutation(internal.scout.browserSessions.open, {
            threadId: args.threadId,
            scoutId,
            source: { kind: "turn", turnId: activeTurnId },
            ...session,
            profileName: scout.firecrawl.profileName,
          });
          browserSessionId = registered.sessionId;
          return { captureOperations: registered.captureOperations };
        },
        onOperationPrepared: async ({ action, toolCallId }) => {
          await beforeModelToolDispatch();
          if (!browserSessionId) throw new Error("Browser session was not registered");
          return await ctx.runMutation(internal.scout.browserSessions.prepareOperation, {
            sessionId: browserSessionId,
            toolCallId,
            action,
          });
        },
        onOperationSettled: async ({ toolCallId, outcome, clickCapture }) => {
          if (!browserSessionId) throw new Error("Browser session was not registered");
          await ctx.runMutation(internal.scout.browserSessions.settleOperation, {
            sessionId: browserSessionId,
            toolCallId,
            outcome,
            clickCapture,
          });
        },
        onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
          if (!browserSessionId) return;
          await ctx.runMutation(internal.scout.browserSessions.close, {
            sessionId: browserSessionId,
            providerDurationMs: sessionDurationMs,
            creditsBilled,
            usageTurnId: activeTurnId,
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
      if (runtimeContext.browserSession) {
        const persisted = runtimeContext.browserSession;
        if (persisted.lifecycle.kind !== "active") {
          throw new Error("Active browser session not found");
        }
        restoreManagedPasswordRedaction({ browser, credentials: runtimeCredentials, scoutId });
        const connection = await attachPersistedBrowserSession(
          browser,
          {
            providerSessionId: persisted.providerSessionId,
            cdpUrl: persisted.lifecycle.cdpUrl,
            interactiveLiveViewUrl: persisted.lifecycle.interactiveLiveViewUrl,
          },
          sliceAbortSignal,
        );
        if (!connection) {
          await ctx.runMutation(internal.scout.browserSessions.close, {
            sessionId: persisted._id,
            providerDurationMs: null,
            creditsBilled: null,
            usageTurnId: activeTurnId,
          });
        } else if (
          connection.cdpUrl !== persisted.lifecycle.cdpUrl ||
          connection.interactiveLiveViewUrl !== persisted.lifecycle.interactiveLiveViewUrl
        ) {
          await ctx.runMutation(internal.scout.browserSessions.replaceConnection, {
            sessionId: persisted._id,
            cdpUrl: connection.cdpUrl,
            interactiveLiveViewUrl: connection.interactiveLiveViewUrl,
          });
        }
        if (connection) browserSessionId = persisted._id;
      }
      requireSecret(getRuntimeEnv("FIRECRAWL_API_KEY"), "FIRECRAWL_API_KEY");
      const agentMailApiKey = requiredAgentMailApiKey(getRuntimeEnv("AGENTMAIL_API_KEY"));
      const agentMailInbox = createAgentMailInboxClient({
        apiKey: agentMailApiKey,
        inboxId: scout.agentMail.inboxId,
      });
      agentMailClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.agentmail.to/mcp",
          headers: {
            "x-api-key": agentMailApiKey,
          },
        },
        initializationOptions: {
          signal: sliceAbortSignal,
          timeout: AGENT_MAIL_REQUEST_TIMEOUT_MS,
        },
      });
      const agentMailTools = {
        ...selectAgentMailTools(
          await loadAgentMailTools(agentMailClient, sliceAbortSignal),
          scout.agentMail.inboxId,
        ),
        ...createAgentMailWriteTools(agentMailInbox, {
          kind: "model",
          promptMessageId: args.promptMessageId,
          beforeDispatch: beforeModelToolDispatch,
        }),
      };
      const activeBrowser = browser;
      if (!activeBrowser) throw new Error("Browser harness was not initialized");
      const humanHandoffCallbacks: HumanHandoffCallbacks = {
        request: async (input) =>
          activeBrowser.transferControl(async () => {
            await beforeModelToolDispatch();
            if (!browserSessionId) {
              throw new Error(
                "No browser session is open. Open the user's requested page with create_new_firecrawl_session, then retry request_human_help. No handoff or email was created.",
              );
            }
            if (!interactiveLiveViewUrl) {
              throw new Error(
                "The current browser has no interactive takeover link. No handoff or email was created. Report this failure to the user; do not replace the handoff with a regular email.",
              );
            }
            humanHandoffAccessToken ??= deriveHumanHandoffAccessToken(
              args.promptMessageId,
              agentMailApiKey,
            );
            const accessToken = humanHandoffAccessToken;
            await ctx.runMutation(internal.humanHandoffs.request, {
              promptMessageId: args.promptMessageId,
              reason: input.reason,
              accessTokenHash: hashHumanHandoffAccessToken(accessToken),
            });
          }),
        onWaiting: () => {
          humanHandoffWaiting = true;
        },
      };
      const accountTools = createAccountTools(ctx, {
        browser: activeBrowser,
        scoutId,
        sessionId: () => browserSessionId,
      });
      const tools = {
        ...browser.tools,
        ...createWebTools(beforeModelToolDispatch),
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
      let activeModelCallId: Id<"scoutModelCalls"> | null = null;
      let modelCallCaptureFailure: Error | undefined;
      const failModelCallCapture = (error: unknown) => {
        if (modelCallCaptureFailure) return;
        modelCallCaptureFailure = new Error("Scout model-input capture failed", { cause: error });
        modelCallCaptureController.abort(modelCallCaptureFailure);
      };
      const timeoutMs = generationSliceTimeoutMs(
        actionStartedAt,
        runtimeContext.startedAt,
        Date.now(),
      );
      if (timeoutMs <= 0) {
        throw new Error("Scout ran out of time before the next model step could start");
      }
      let callPurpose: NonNullable<Doc<"scoutModelCalls">["purpose"]> = { kind: "compaction" };
      let lastCompletedModelCallId: Id<"scoutModelCalls"> | null = null;
      const modelCallCallbacks = {
        onLanguageModelCallStart: async (event: LanguageModelCallStartEvent) => {
          try {
            if (activeModelCallId) {
              await ctx.runMutation(internal.scout.modelCalls.failOne, {
                modelCallId: activeModelCallId,
                failure: "Model call was retried before a response completed",
              });
              activeModelCallId = null;
            }
            const snapshot = modelCallContext(event);
            const blob = new Blob([snapshot], { type: "application/json" });
            const snapshotStorageId = await ctx.storage.store(blob);
            try {
              const modelCallId = await ctx.runMutation(internal.scout.modelCalls.recordStart, {
                turnId: activeTurnId,
                purpose: callPurpose,
                provider: event.provider,
                modelId: event.modelId,
                messageCount: event.messages.length,
                toolCount: event.tools?.length ?? 0,
                compactedBrowserSnapshotCount: compactedBrowserSnapshotCount(event.messages),
                serializedBytes: blob.size,
                snapshotStorageId,
              });
              activeModelCallId = modelCallId;
            } catch (error) {
              await ctx.storage.delete(snapshotStorageId);
              throw error;
            }
          } catch (error) {
            console.error("Failed to capture Scout model input", error);
            failModelCallCapture(error);
          }
        },
        onLanguageModelCallEnd: async (
          event: Pick<LanguageModelCallEndEvent, "usage" | "finishReason">,
        ) => {
          const modelCallId = activeModelCallId;
          if (!modelCallId) return;
          accumulatedUsage = addScoutTokenUsage(accumulatedUsage, tokenUsage(event.usage));
          try {
            await ctx.runMutation(internal.scout.modelCalls.recordEnd, {
              modelCallId,
              finishReason: event.finishReason,
              usage: tokenUsage(event.usage),
            });
            lastCompletedModelCallId = modelCallId;
          } catch (error) {
            console.error("Failed to finish Scout model input capture", error);
            try {
              await ctx.runMutation(internal.scout.modelCalls.failOne, {
                modelCallId,
                failure: `Completion capture failed: ${generationErrorDetails(error)}`,
              });
            } catch (failureError) {
              console.error("Failed to mark Scout model input capture as failed", failureError);
              failModelCallCapture(
                new AggregateError(
                  [error, failureError],
                  "Model input completion and failure capture both failed",
                ),
              );
              return;
            }
            failModelCallCapture(error);
          } finally {
            activeModelCallId = null;
          }
        },
      };
      const fixedTokens = estimateContextTokens({
        instructions,
        tools: await Promise.all(
          Object.entries(tools).map(async ([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: await asSchema<unknown>(tool.inputSchema).jsonSchema,
          })),
        ),
      });
      const prepared = await prepareConversationContext(ctx, {
        threadId: args.threadId,
        promptMessageId: args.promptMessageId,
        threshold: compactionThreshold(getRuntimeEnv("SCOUT_COMPACTION_TOKENS")),
        fixedTokens,
        preserveObjective: (messages) => preserveTurnObjective(messages, objective),
        summarize: async (input) => {
          await beforeModelToolDispatch();
          callPurpose = { kind: "compaction" };
          lastCompletedModelCallId = null;
          const result = await generateText({
            model: scoutLanguageModel(args.model),
            instructions: SUMMARY_INSTRUCTIONS,
            prompt: JSON.stringify(input),
            maxOutputTokens: 8_192,
            reasoning: "none",
            abortSignal: sliceAbortSignal,
            maxRetries: 2,
            ...modelCallCallbacks,
          });
          if (modelCallCaptureFailure) throw modelCallCaptureFailure;
          if (result.finishReason !== "stop" || !lastCompletedModelCallId) {
            throw new Error(
              `Conversation summarization ended with ${result.finishReason}; original history is unchanged`,
            );
          }
          return { summary: result.text.trim(), modelCallId: lastCompletedModelCallId };
        },
      });
      callPurpose = { kind: "generation", compactionId: prepared.compactionId };
      const streamResult = await scoutAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: scoutLanguageModel(args.model),
          instructions,
          tools,
          repairToolCall: repairStringifiedToolInput,
          abortSignal: sliceAbortSignal,
          maxRetries: 2,
          timeout: { totalMs: timeoutMs },
          stopWhen: isStepCount(sliceStepLimit),
          onError: streamErrors.onError,
          ...modelCallCallbacks,
          prepareStep: async () => {
            await beforeModelToolDispatch();
            return { messages: prepared.messages };
          },
        },
        {
          contextOptions: { recentMessages: RECENT_MESSAGE_FETCH_LIMIT },
          saveStreamDeltas: {
            returnImmediately: true,
            chunking: "word",
            throttleMs: 100,
          },
          contextHandler: async () => prepared.messages,
        },
      );
      await streamResult.consumeStream();
      if (modelCallCaptureFailure) throw modelCallCaptureFailure;
      streamErrors.throwIfCaptured();
      const steps = await streamResult.steps;
      const finishReason = await streamResult.finishReason;
      const completedSteps = progress.completedSteps + steps.length;
      const finalStep = steps.at(-1);
      const usage = addScoutTokenUsage(
        previousUsage,
        accumulatedUsage ?? tokenUsage(await streamResult.totalUsage),
      );
      if (humanHandoffWaiting || finishReason === "stop") {
        generationResult = { kind: "completed", usage };
      } else if (finishReason === "tool-calls" && completedSteps >= MAX_TURN_STEPS) {
        generationResult = {
          kind: "failed",
          error: new Error(`Scout reached the ${MAX_TURN_STEPS}-step safety limit`),
          usage,
        };
      } else if (Date.now() - runtimeContext.startedAt >= MAX_TURN_DURATION_MS) {
        generationResult = {
          kind: "failed",
          error: new Error("Scout reached the 45-minute turn safety limit"),
          usage,
        };
      } else if (
        generationNeedsContinuation(
          finishReason,
          steps.length,
          progress.completedSteps,
          sliceStepLimit,
        ) &&
        finalStep !== undefined &&
        finalStepToolsCompleted(finalStep)
      ) {
        generationResult = { kind: "continued", completedSteps, usage };
      } else {
        generationResult = {
          kind: "failed",
          error: new Error(`Scout generation ended with finish reason ${finishReason}`),
          usage,
        };
      }
      if (generationResult.kind === "continued") {
        await ctx.runMutation(internal.scout.turns.continueAfterSlice, {
          promptMessageId: args.promptMessageId,
          previousCompletedSteps: progress.completedSteps,
          completedSteps: generationResult.completedSteps,
          usage: generationResult.usage,
        });
      }
    } catch (error) {
      if (turnId) {
        try {
          await ctx.runMutation(internal.scout.modelCalls.failPending, {
            turnId,
            failure: generationErrorDetails(error),
          });
        } catch (captureError) {
          console.error("Failed to mark Scout model input capture as failed", captureError);
        }
      }
      generationResult = {
        kind: "failed",
        error,
        ...omitNullish({
          usage:
            accumulatedUsage === undefined
              ? previousUsage
              : addScoutTokenUsage(previousUsage, accumulatedUsage),
        }),
      };
    }

    await browser?.drain();
    const preserveBrowserForHandoff = generationResult.kind === "completed" && humanHandoffWaiting;
    const preserveBrowserForContinuation = generationResult.kind === "continued";
    let cleanupFailure: unknown;
    if (!preserveBrowserForHandoff && !preserveBrowserForContinuation) {
      try {
        const cleanup =
          turnId && browserSessionId
            ? await ctx.runMutation(internal.scout.turns.beginBrowserCleanup, {
                turnId,
                sessionId: browserSessionId,
              })
            : "close";
        if (cleanup === "close") await closeGenerationBrowser(browser);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    let completionFailure: unknown;
    if (generationResult.kind !== "failed" && !cleanupFailure && !completionFailure) {
      try {
        if (!preserveBrowserForContinuation) {
          if (preserveBrowserForHandoff) {
            await ctx.runMutation(internal.scout.turns.completeHumanHandoffPause, {
              promptMessageId: args.promptMessageId,
              usage: generationResult.usage,
            });
          } else {
            await ctx.runMutation(internal.scout.turns.complete, {
              promptMessageId: args.promptMessageId,
              usage: generationResult.usage,
            });
          }
        }
        await closeAgentMailBestEffort(agentMailClient);
        return { kind: preserveBrowserForContinuation ? "continued" : "completed" };
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
        ...omitNullish({ usage: failureDetails.usage }),
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
