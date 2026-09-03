"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { asSchema } from "@ai-sdk/provider-utils";
import type { Message } from "@convex-dev/agent";
import { randomUUID } from "node:crypto";
import { type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, env, type ActionCtx } from "../_generated/server";
import { findActiveBrowserSession } from "../humanHandoffBrowser";
import { createAccountTools } from "./accountTools";
import { scoutAgent } from "./agent";
import { closeAgentMailBestEffort } from "./generation";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { diagnosticMessage } from "./lib/redaction";
import { requireRuntimeTool } from "./lib/runtimeTool";
import { runnerToolNames, runnerToolNameValidator } from "./runnerToolNames";
import { createToolArgumentProbe } from "./toolArgumentProbe";
import { createWebTools } from "./webTools";

const manualToolNameValidator = v.union(
  runnerToolNameValidator,
  v.literal("inspect_tool_arguments"),
);
const jsonValueSchema = z.json();

type ManualToolName = typeof manualToolNameValidator.type;
type Browser = ReturnType<typeof createBrowserHarness>;

const runnerToolDefinitionValidator = v.object({
  name: runnerToolNameValidator,
  description: v.string(),
  inputSchemaJson: v.string(),
});
type RunnerToolDescription = typeof runnerToolDefinitionValidator.type;

const manualToolOutcomeValidator = v.union(
  v.object({ kind: v.literal("success"), output: v.string() }),
  v.object({ kind: v.literal("error"), error: v.string() }),
);

const manualToolResultValidator = v.object({
  toolCallId: v.string(),
  outcome: manualToolOutcomeValidator,
});

const runnerTurnOutcomeValidator = v.union(
  v.object({ kind: v.literal("completed"), response: v.string() }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
);

const MAX_PROMPT_LENGTH = 16_000;
const MAX_RESPONSE_LENGTH = 64_000;
const MAX_THREAD_TITLE_LENGTH = 80;

function requiredSecret(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value;
}

function parseManualToolInput(value: string): JSONValue {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("Tool input must be valid JSON");
  }
  const parsed = jsonValueSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Tool input must be valid JSON");
  return parsed.data;
}

function boundedText(value: string, label: string, maximumLength: number) {
  const text = value.trim();
  if (!text) throw new Error(`${label} cannot be empty`);
  if (text.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`);
  }
  return text;
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.replaceAll(/\s+/g, " ");
  const characters = Array.from(normalized);
  if (characters.length <= MAX_THREAD_TITLE_LENGTH) return normalized;
  return `${characters.slice(0, MAX_THREAD_TITLE_LENGTH - 1).join("")}…`;
}

async function requirePromptMessage(
  ctx: ActionCtx,
  args: { threadId: string; promptMessageId: string; userId: Id<"users"> },
) {
  const [message] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
    messageIds: [args.promptMessageId],
  });
  if (
    !message ||
    message.threadId !== args.threadId ||
    message.userId !== args.userId ||
    message.message?.role !== "user"
  ) {
    throw new Error("Runner prompt message not found");
  }
}

async function describeRunnerTools(tools: ToolSet): Promise<RunnerToolDescription[]> {
  return await Promise.all(
    runnerToolNames.map(async (name) => {
      const selected = tools[name];
      if (!selected) throw new Error(`Tool ${name} is unavailable`);
      return {
        name,
        description: typeof selected.description === "string" ? selected.description : name,
        inputSchemaJson: JSON.stringify(
          jsonValueSchema.parse(await asSchema(selected.inputSchema).jsonSchema),
        ),
      };
    }),
  );
}

function usesAgentMail(toolName: ManualToolName) {
  return (
    toolName === "list_messages" || toolName === "search_messages" || toolName === "get_thread"
  );
}

function needsExistingBrowser(toolName: ManualToolName) {
  return (
    toolName === "browser_execute" ||
    toolName === "fill_account_password" ||
    toolName === "record_authenticated_service_account"
  );
}

async function attachBrowser(
  browser: Browser,
  providerSessionId: string,
  clearStaleSession: () => Promise<void>,
) {
  const active = await findActiveBrowserSession(providerSessionId);
  if (!active) {
    await clearStaleSession();
    throw new Error("The browser session has expired. Create a new Firecrawl session.");
  }
  await browser.attach({ providerSessionId: active.sessionId, cdpUrl: active.cdpUrl });
}

export const describeTools = action({
  args: { threadId: v.string() },
  returns: v.object({ tools: v.array(runnerToolDefinitionValidator) }),
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    let agentMailClient: MCPClient | undefined;
    try {
      agentMailClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.agentmail.to/mcp",
          headers: {
            "x-api-key": requiredSecret(env.AGENTMAIL_API_KEY, "AGENTMAIL_API_KEY"),
          },
        },
      });
      const browser = createBrowserHarness();
      const credentials = await ctx.runQuery(
        internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
        { scoutId: runtime.scoutId },
      );
      const tools: ToolSet = {
        ...browser.tools,
        ...createWebTools(),
        ...selectAgentMailTools(await agentMailClient.tools(), runtime.inboxId),
        ...createAccountTools(ctx, {
          browser,
          scoutId: runtime.scoutId,
          credentials,
          sessionId: () => runtime.browserSessionId,
        }),
      };
      return { tools: await describeRunnerTools(tools) };
    } finally {
      await closeAgentMailBestEffort(agentMailClient);
    }
  },
});

export const beginTurn = action({
  args: { threadId: v.string(), prompt: v.string() },
  returns: v.object({ promptMessageId: v.string() }),
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    const prompt = boundedText(args.prompt, "Message", MAX_PROMPT_LENGTH);
    const thread = await scoutAgent.getThreadMetadata(ctx, { threadId: args.threadId });
    if (!thread.title) {
      await scoutAgent.updateThreadMetadata(ctx, {
        threadId: args.threadId,
        patch: { title: titleFromPrompt(prompt) },
      });
    }
    const { messageId } = await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId: runtime.userId,
      prompt,
      skipEmbeddings: true,
    });
    return { promptMessageId: messageId };
  },
});

export const finishTurn = action({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    outcome: runnerTurnOutcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    await requirePromptMessage(ctx, { ...args, userId: runtime.userId });
    const text =
      args.outcome.kind === "completed"
        ? boundedText(args.outcome.response, "Response", MAX_RESPONSE_LENGTH)
        : `Codex runner failed: ${boundedText(args.outcome.error, "Failure", MAX_RESPONSE_LENGTH)}`;
    await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId: runtime.userId,
      promptMessageId: args.promptMessageId,
      message: { role: "assistant", content: text },
      skipEmbeddings: true,
    });
    return null;
  },
});

export const executeTool = action({
  args: {
    threadId: v.string(),
    promptMessageId: v.optional(v.string()),
    toolName: manualToolNameValidator,
    input: v.string(),
  },
  returns: manualToolResultValidator,
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    const toolCallId = randomUUID();
    const input = parseManualToolInput(args.input);
    let promptMessageId = args.promptMessageId;
    if (promptMessageId) {
      await requirePromptMessage(ctx, {
        threadId: args.threadId,
        promptMessageId,
        userId: runtime.userId,
      });
    } else {
      const saved = await scoutAgent.saveMessage(ctx, {
        threadId: args.threadId,
        userId: runtime.userId,
        prompt: `Manual tool call: ${args.toolName}`,
        skipEmbeddings: true,
      });
      promptMessageId = saved.messageId;
    }
    const toolCallMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName: args.toolName,
          input,
        },
      ],
    } satisfies ModelMessage;
    await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId: runtime.userId,
      promptMessageId,
      message: toolCallMessage,
      skipEmbeddings: true,
    });

    let agentMailClient: MCPClient | undefined;
    let browser: Browser | undefined;
    let currentBrowserSessionId = runtime.browserSessionId;
    let output: JSONValue = null;
    let executionError: string | undefined;
    try {
      let selectedTools: ToolSet;
      if (usesAgentMail(args.toolName)) {
        agentMailClient = await createMCPClient({
          transport: {
            type: "http",
            url: "https://mcp.agentmail.to/mcp",
            headers: {
              "x-api-key": requiredSecret(env.AGENTMAIL_API_KEY, "AGENTMAIL_API_KEY"),
            },
          },
        });
        selectedTools = selectAgentMailTools(await agentMailClient.tools(), runtime.inboxId);
      } else if (args.toolName === "inspect_tool_arguments") {
        selectedTools = { inspect_tool_arguments: createToolArgumentProbe() };
      } else if (args.toolName === "web_search" || args.toolName === "web_read") {
        selectedTools = createWebTools();
      } else {
        if (args.toolName === "create_new_firecrawl_session" && runtime.providerSessionId) {
          throw new Error("This chat already has an open browser session");
        }
        browser = createBrowserHarness({
          profileName: runtime.profileName,
          onSessionAvailable: async (providerSessionId) => {
            const registered = await ctx.runMutation(internal.scout.browserSessions.open, {
              threadId: args.threadId,
              scoutId: runtime.scoutId,
              providerSessionId,
              profileName: runtime.profileName,
            });
            currentBrowserSessionId = registered.sessionId;
            return { captureOperations: registered.captureOperations };
          },
          onOperationPrepared: async ({ action, toolCallId }) => {
            if (currentBrowserSessionId === null) {
              throw new Error("Browser session was not registered");
            }
            return await ctx.runMutation(internal.scout.browserSessions.prepareOperation, {
              sessionId: currentBrowserSessionId,
              toolCallId,
              action,
            });
          },
          onOperationSettled: async ({ toolCallId, outcome }) => {
            if (currentBrowserSessionId === null) {
              throw new Error("Browser session was not registered");
            }
            await ctx.runMutation(internal.scout.browserSessions.settleOperation, {
              sessionId: currentBrowserSessionId,
              toolCallId,
              outcome,
            });
          },
          onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.browserSessions.close, {
              sessionId: currentBrowserSessionId,
              providerDurationMs: sessionDurationMs,
              creditsBilled,
            });
            currentBrowserSessionId = null;
          },
          onLiveViewAvailable: async (liveViewUrl) => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.browserSessions.setLiveView, {
              sessionId: currentBrowserSessionId,
              liveViewUrl,
            });
          },
          onLiveViewClosed: async () => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.browserSessions.clearLiveView, {
              sessionId: currentBrowserSessionId,
            });
          },
        });
        if (
          runtime.providerSessionId &&
          (needsExistingBrowser(args.toolName) || args.toolName === "browser_close")
        ) {
          await attachBrowser(browser, runtime.providerSessionId, async () => {
            if (runtime.browserSessionId === null) return;
            await ctx.runMutation(internal.scout.browserSessions.close, {
              sessionId: runtime.browserSessionId,
              providerDurationMs: null,
              creditsBilled: null,
            });
          });
        } else if (needsExistingBrowser(args.toolName)) {
          throw new Error("Open a browser session before using it");
        }

        if (
          args.toolName === "fill_account_password" ||
          args.toolName === "record_authenticated_service_account"
        ) {
          const credentials = await ctx.runQuery(
            internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
            { scoutId: runtime.scoutId },
          );
          selectedTools = createAccountTools(ctx, {
            browser,
            scoutId: runtime.scoutId,
            credentials,
            sessionId: () => currentBrowserSessionId,
          });
        } else {
          selectedTools = browser.tools;
        }
      }
      output = jsonValueSchema.parse(
        await requireRuntimeTool(selectedTools, args.toolName).execute(input, {
          toolCallId,
          messages: [],
          context: undefined,
        }),
      );
    } catch (error) {
      executionError = diagnosticMessage(error);
      if (args.toolName === "create_new_firecrawl_session") {
        await browser?.close().catch(() => undefined);
      }
    } finally {
      await closeAgentMailBestEffort(agentMailClient);
    }

    const outcome: typeof manualToolOutcomeValidator.type = executionError
      ? { kind: "error", error: executionError }
      : { kind: "success", output: JSON.stringify(output) ?? "null" };
    const toolResultMessage = {
      role: "tool",
      content: [
        executionError
          ? {
              type: "tool-result",
              toolCallId,
              toolName: args.toolName,
              output: { type: "error-text", value: executionError },
              isError: true,
            }
          : {
              type: "tool-result",
              toolCallId,
              toolName: args.toolName,
              output: { type: "json", value: output },
            },
      ],
    } satisfies Message;
    await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId: runtime.userId,
      promptMessageId,
      message: toolResultMessage,
      skipEmbeddings: true,
    });
    return { toolCallId, outcome };
  },
});
