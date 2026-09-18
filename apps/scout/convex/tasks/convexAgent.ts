"use node";

import { Agent, type MessageDoc } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { asSchema } from "@ai-sdk/provider-utils";
import { generateText, isStepCount, tool, type ToolSet } from "ai";
import type { PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { setTimeout as delay } from "node:timers/promises";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { omitNullish } from "../../shared/omitNullish";
import { getRuntimeEnv } from "../runtimeEnv";
import {
  compactionThreshold,
  estimateContextTokens,
  SUMMARY_INSTRUCTIONS,
} from "../scout/modelContext";
import { closeBrowser, executeTaskTool, taskInstructions } from "./execution";
import type { command, sessionItem } from "./model";
import { handoffInput, runtimeTools } from "./tools";
import { repairStringifiedToolInput } from "./toolCallRepair";
import {
  accumulatedUsage,
  addUsage,
  generationUsage,
  prepareContext,
  zeroUsage,
  pendingToolCalls,
  projectMessage,
  textItem,
  toolCallItem,
} from "./convexAgentModel";

const MAX_STEPS = 120;
const MAX_TURN_MS = 45 * 60_000;
const MODEL_TIMEOUT_MS = 6 * 60_000;

function gatewayModel(model: string) {
  switch (model) {
    case "gpt-5.6-luna":
      return convexGateway("openai/gpt-5.6-luna");
    default:
      throw new Error(`Unsupported Convex Agent model: ${model}`);
  }
}

async function saveUsage(
  ctx: ActionCtx,
  session: Doc<"agentsApiSessions">,
  history: MessageDoc[],
  refresh: boolean,
) {
  const context = await ctx.runQuery(internal.tasks.convexAgentRecords.context, {
    sessionId: session._id,
  });
  const reported = accumulatedUsage(history);
  const usage = addUsage(reported.usage, context?.usage ?? zeroUsage);
  await ctx.runMutation(internal.tasks.sessions.update, {
    sessionId: session._id,
    ...omitNullish({ refreshWorkflowId: refresh ? (session.workflowId ?? null) : undefined }),
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
        }
      : null,
    reportedModelUsd: usage?.costUsd ?? null,
    modelUsageIncomplete: reported.incomplete || (context !== null && context.usage === null),
  });
}

async function loadMessages(
  ctx: ActionCtx,
  threadId: string,
  stop: { currentOrder: number; boundary: { order: number; stepOrder: number } } | null,
) {
  const messages: MessageDoc[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: PaginationResult<MessageDoc> = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId,
        order: "desc",
        paginationOpts: { cursor, numItems: 100, maximumBytesRead: 2_000_000 },
      },
    );
    for (const message of page.page) {
      if (
        stop &&
        message.order < stop.currentOrder &&
        (message.order < stop.boundary.order ||
          (message.order === stop.boundary.order && message.stepOrder <= stop.boundary.stepOrder))
      )
        return messages.reverse();
      messages.push(message);
    }
    if (page.isDone) return messages.reverse();
    cursor = page.continueCursor;
  }
}

async function saveProjection(
  ctx: ActionCtx,
  session: Doc<"agentsApiSessions">,
  messages: MessageDoc[],
  refresh: boolean,
) {
  for (const message of messages) {
    const items = projectMessage(message);
    if (!items.length) continue;
    await ctx.runMutation(internal.tasks.sessions.saveItems, {
      sessionId: session._id,
      ...omitNullish({ refreshWorkflowId: refresh ? (session.workflowId ?? null) : undefined }),
      items,
    });
  }
}

export async function begin(
  ctx: ActionCtx,
  args: { sessionId: Id<"agentsApiSessions">; command: Infer<typeof command> },
): Promise<boolean> {
  const { session } = await ctx.runQuery(internal.tasks.sessions.runtime, {
    sessionId: args.sessionId,
  });
  if (session.state.kind === "stopped") {
    await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, { sessionId: session._id });
    return false;
  }
  switch (args.command.kind) {
    case "start":
    case "send": {
      const messageId = await ctx.runMutation(internal.tasks.convexAgentRecords.prompt, {
        sessionId: session._id,
        prompt: args.command.kind === "start" ? args.command.prompt : args.command.message,
        start: args.command.kind === "start",
      });
      if (!messageId) {
        await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, { sessionId: session._id });
        return false;
      }
      const [message] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [messageId],
      });
      if (!message) throw new Error("Convex Agent prompt was not saved");
      await saveProjection(ctx, session, [message], false);
      return true;
    }
    case "resume":
      return await ctx.runMutation(internal.tasks.convexAgentRecords.resume, {
        sessionId: session._id,
        checkId: args.command.checkId,
      });
    case "observe":
      return true;
  }
}

async function serviceNextCall(
  ctx: ActionCtx,
  session: Doc<"agentsApiSessions">,
  messages: MessageDoc[],
) {
  const call = pendingToolCalls(messages)[0];
  if (!call) return { kind: "none" } as const;
  if (!session.previousTurnId) throw new Error("Convex Agent prompt is missing");
  const current = await ctx.runQuery(internal.tasks.sessions.runtime, { sessionId: session._id });
  if (current.session.state.kind === "stopped") return { kind: "stopped" } as const;
  if (call.name === "request_browser_handoff") {
    const { message } = handoffInput.parse(call.arguments);
    const waiting = await ctx.runMutation(internal.tasks.sessions.enterHandoff, {
      sessionId: session._id,
      message,
      callId: call.callId,
      turnId: session.previousTurnId,
    });
    return waiting ? ({ kind: "waiting" } as const) : ({ kind: "stopped" } as const);
  }
  const result = await executeTaskTool(ctx, { ...current, call });
  await ctx.runMutation(internal.tasks.convexAgentRecords.toolResult, {
    sessionId: session._id,
    promptMessageId: session.previousTurnId,
    callId: call.callId,
    name: call.name,
    result,
  });
  return { kind: "executed" } as const;
}

export async function advance(
  ctx: ActionCtx,
  args: { sessionId: Id<"agentsApiSessions"> },
): Promise<boolean> {
  const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, args);
  if (session.state.kind === "stopped") {
    await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, args);
    return false;
  }
  if (session.state.kind === "waiting") return false;
  if (!session.providerId || !session.previousTurnId)
    throw new Error("Convex Agent thread or prompt is missing");
  const threadId = session.providerId;
  const promptMessageId = session.previousTurnId;
  const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
    messageIds: [promptMessageId],
  });
  if (!prompt) throw new Error("Convex Agent prompt was not found");
  const context = await ctx.runQuery(internal.tasks.convexAgentRecords.context, args);
  const history = await loadMessages(
    ctx,
    threadId,
    context ? { currentOrder: prompt.order, boundary: context.coveredThrough } : null,
  );
  const messages = history.filter((message) => message.order === prompt.order);
  const next = await serviceNextCall(ctx, session, messages);
  if (next.kind === "stopped") {
    await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, args);
    return false;
  }
  if (next.kind !== "none") return next.kind === "executed";
  const steps = messages.filter(
    (message) => message.message?.role === "assistant" && message.status === "success",
  );
  const last = steps.at(-1);
  if (last && pendingToolCalls([last]).length === 0) {
    if (last.finishReason !== "stop")
      throw new Error(`Convex Agent generation ended with ${last.finishReason ?? "unknown"}`);
    await closeBrowser(ctx, session);
    await ctx.runMutation(internal.tasks.sessions.update, {
      sessionId: session._id,
      state: { kind: "idle" },
      active: false,
    });
    return false;
  }
  if (messages.some((message) => message.status === "pending" || message.status === "failed"))
    throw new Error(
      "Convex Agent step was interrupted. Inspect its outcome before sending a follow-up.",
    );
  if (steps.length >= MAX_STEPS)
    throw new Error(`Convex Agent reached the ${MAX_STEPS}-step limit`);
  const startedAt =
    session.state.kind === "running"
      ? (session.state.resumedAtMs ?? prompt._creationTime)
      : prompt._creationTime;
  const remainingMs = MAX_TURN_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error("Convex Agent reached the 45-minute turn limit");

  const resource = await runtimeTools(ctx, session, scout, null, purpose);
  const controller = new AbortController();
  const finished = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Convex Agent model step timed out")),
    Math.min(MODEL_TIMEOUT_MS, remainingMs),
  );
  let stopRequested = false;
  const watch = async () => {
    try {
      while (!finished.signal.aborted) {
        await delay(1_000, undefined, { signal: finished.signal });
        const current = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
        if (current.state.kind === "stopped") {
          stopRequested = true;
          controller.abort(new Error("Task stopped"));
          return;
        }
      }
    } catch (error) {
      if (finished.signal.aborted && error instanceof Error && error.name === "AbortError") return;
      controller.abort(error);
      throw error;
    }
  };
  const generate = async () => {
    const tools: ToolSet = Object.fromEntries(
      Object.entries(resource.tools).map(([name, definition]) => [
        name,
        tool({
          inputSchema: definition.inputSchema,
          ...omitNullish({ description: definition.description }),
        }),
      ]),
    );
    const model = gatewayModel(session.model);
    const agent = new Agent(components.agent, {
      name: "Scout",
      languageModel: model,
      usageHandler: async (usageCtx, { usage }) => {
        await usageCtx.runMutation(internal.tasks.convexAgentRecords.recordUsage, {
          sessionId: session._id,
          usage: generationUsage(usage),
        });
      },
    });
    const instructions = await taskInstructions(ctx, session, scout, purpose);
    const fixedTokens = estimateContextTokens({
      instructions,
      tools: await Promise.all(
        Object.entries(tools).map(async ([name, definition]) => ({
          name,
          description: definition.description,
          inputSchema: await asSchema(definition.inputSchema).jsonSchema,
        })),
      ),
    });
    const prepared = prepareContext(
      history,
      prompt,
      context,
      fixedTokens,
      compactionThreshold(getRuntimeEnv("SCOUT_COMPACTION_TOKENS")),
    );
    if (prepared.kind === "compact") {
      const summary = await generateText({
        model,
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: JSON.stringify(prepared.input),
        maxOutputTokens: 8_192,
        reasoning: "none",
        maxRetries: 0,
        abortSignal: controller.signal,
      });
      if (summary.finishReason !== "stop")
        throw new Error(`Task summarization ended with ${summary.finishReason}`);
      const summaryStep = summary.steps[0];
      if (!summaryStep || summary.steps.length !== 1)
        throw new Error("Task summarization did not produce exactly one model step");
      prepared.validateSummary(summary.text);
      await ctx.runMutation(internal.tasks.convexAgentRecords.saveContext, {
        sessionId: session._id,
        summary: summary.text.trim(),
        coveredThrough: prepared.coveredThrough,
        previousBoundary: context?.coveredThrough ?? null,
        usage: generationUsage(summaryStep.usage),
      });
      return;
    }
    const stream = await agent.streamText(
      ctx,
      { threadId, userId: session.userId },
      {
        promptMessageId,
        instructions,
        tools,
        repairToolCall: repairStringifiedToolInput,
        ...omitNullish({
          providerOptions:
            session.model === "gpt-5.6-luna" || session.model === "openai/gpt-5.6-luna"
              ? { convexGateway: { reasoningEffort: "max" } }
              : undefined,
        }),
        stopWhen: isStepCount(1),
        maxRetries: 0,
        abortSignal: controller.signal,
      },
      {
        contextOptions: { recentMessages: 0 },
        contextHandler: async () => prepared.messages,
      },
    );
    const pending = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    const messageId = pending.page[0]?._id;
    if (!messageId) throw new Error("Convex Agent pending message was not created");
    const dirty = new Map<string, Infer<typeof sessionItem>>();
    let text = "";
    let reasoning = "";
    let lastFlush = 0;
    const flush = async () => {
      const items = [...dirty.values()];
      dirty.clear();
      if (items.length)
        await ctx.runMutation(internal.tasks.sessions.saveItems, { sessionId: session._id, items });
      lastFlush = Date.now();
    };
    try {
      for await (const part of stream.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") {
          text += part.text;
          const item = textItem(messageId, "assistant", text, false);
          dirty.set(item.providerItemId, item);
        } else if (part.type === "reasoning-delta") {
          reasoning += part.text;
          const item = textItem(messageId, "reasoning", reasoning, false);
          dirty.set(item.providerItemId, item);
        } else if (part.type === "tool-call") {
          const item = toolCallItem({
            callId: part.toolCallId,
            name: part.toolName,
            arguments: part.input,
          });
          dirty.set(item.providerItemId, item);
        }
        if (Date.now() - lastFlush >= 500) await flush();
      }
      await flush();
      const saved = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [messageId],
      });
      await saveProjection(
        ctx,
        session,
        saved.flatMap((message) => (message ? [message] : [])),
        false,
      );
      const reason = await stream.finishReason;
      if (!stopRequested && reason !== "stop" && reason !== "tool-calls")
        throw new Error(`Convex Agent generation ended with ${reason}`);
    } finally {
      if (text) {
        const item = textItem(messageId, "assistant", text, true);
        dirty.set(item.providerItemId, item);
      }
      if (reasoning) {
        const item = textItem(messageId, "reasoning", reasoning, true);
        dirty.set(item.providerItemId, item);
      }
      await flush();
    }
  };
  try {
    const results = await Promise.allSettled([generate().finally(() => finished.abort()), watch()]);
    for (const result of results)
      if (result.status === "rejected" && !stopRequested) throw result.reason;
    if (stopRequested) await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, args);
    return !stopRequested;
  } finally {
    clearTimeout(timeout);
    finished.abort();
    controller.abort();
    await resource.dispose();
  }
}

export async function cancelExecution(ctx: ActionCtx, session: Doc<"agentsApiSessions">) {
  if (!session.providerId) return;
  const messages = await loadMessages(ctx, session.providerId, null);
  for (const message of messages) {
    if (message.status === "pending")
      await ctx.runMutation(components.agent.messages.finalizeMessage, {
        messageId: message._id,
        result: { status: "failed", error: "Task execution stopped" },
      });
  }
  const prompt = messages.find((message) => message._id === session.previousTurnId);
  if (prompt) {
    for (const call of pendingToolCalls(
      messages.filter((message) => message.order === prompt.order),
    ))
      await ctx.runMutation(internal.tasks.convexAgentRecords.interruptTool, {
        sessionId: session._id,
        promptMessageId: prompt._id,
        callId: call.callId,
        name: call.name,
      });
  }
}

export async function refreshExecution(ctx: ActionCtx, session: Doc<"agentsApiSessions">) {
  if (!session.providerId) return;
  const messages = await loadMessages(ctx, session.providerId, null);
  await saveProjection(ctx, session, messages, true);
  await saveUsage(ctx, session, messages, true);
}
