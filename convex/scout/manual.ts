"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { validateTypes } from "@ai-sdk/provider-utils";
import type { Message } from "@convex-dev/agent";
import { randomUUID } from "node:crypto";
import { type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { findActiveBrowserSession } from "../humanHandoffBrowser";
import { createAccountTools } from "./accountTools";
import { scoutAgent } from "./agent";
import { closeAgentMailBestEffort } from "./generation";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { diagnosticMessage } from "./lib/redaction";
import { createToolArgumentProbe } from "./toolArgumentProbe";
import { createWebTools } from "./webTools";

const manualToolNameValidator = v.union(
  v.literal("create_new_firecrawl_session"),
  v.literal("browser_execute"),
  v.literal("browser_close"),
  v.literal("list_messages"),
  v.literal("search_messages"),
  v.literal("get_thread"),
  v.literal("fill_account_password"),
  v.literal("record_authenticated_service_account"),
  v.literal("web_search"),
  v.literal("web_read"),
  v.literal("inspect_tool_arguments"),
);

type ManualToolName = typeof manualToolNameValidator.type;
type Browser = ReturnType<typeof createBrowserHarness>;

const manualToolOutcomeValidator = v.union(
  v.object({ kind: v.literal("success"), output: v.any() }),
  v.object({ kind: v.literal("error"), error: v.string() }),
);

const manualToolResultValidator = v.object({
  toolCallId: v.string(),
  outcome: manualToolOutcomeValidator,
});

function requiredSecret(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value;
}

function jsonValue(value: unknown, seen = new WeakSet<object>()): JSONValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : value.toString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => jsonValue(entry, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, JSONValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = jsonValue(entry, seen);
  }
  seen.delete(value);
  return result;
}

function manualToolExecutionOptions(toolCallId: string) {
  return { toolCallId, messages: [], context: undefined };
}

async function runTool(tools: ToolSet, toolName: string, input: JSONValue, toolCallId: string) {
  const selected = tools[toolName];
  if (!selected) throw new Error(`Tool ${toolName} is unavailable`);
  if (!("inputSchema" in selected)) throw new Error(`Tool ${toolName} cannot accept input`);
  const execute: unknown = "execute" in selected ? selected.execute : undefined;
  if (typeof execute !== "function") throw new Error(`Tool ${toolName} cannot be executed`);
  const parsed = await validateTypes({ value: input, schema: selected.inputSchema });
  return await Reflect.apply(execute, undefined, [parsed, manualToolExecutionOptions(toolCallId)]);
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

export const executeTool = action({
  args: {
    threadId: v.string(),
    toolName: manualToolNameValidator,
    input: v.any(),
  },
  returns: manualToolResultValidator,
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    const toolCallId = randomUUID();
    const input = jsonValue(args.input);
    const { messageId: promptMessageId } = await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId: runtime.userId,
      prompt: `Manual tool call: ${args.toolName}`,
      skipEmbeddings: true,
    });
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
    let rawOutput: unknown;
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
      rawOutput = await runTool(selectedTools, args.toolName, input, toolCallId);
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
      : { kind: "success", output: jsonValue(rawOutput) };
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
              output: { type: "json", value: jsonValue(rawOutput) },
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
