"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { Message } from "@convex-dev/agent";
import { randomUUID } from "node:crypto";
import { type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { createAccountTools } from "./accountTools";
import { createAgentMailWriteTools } from "./agentMailTools";
import { scoutAgent } from "./agent";
import { closeAgentMailBestEffort } from "./generation";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { attachPersistedBrowserSession } from "./browserSessionConnection";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "./lib/agentMail";
import { diagnosticMessage } from "./lib/redaction";
import { requireRuntimeTool } from "./lib/runtimeTool";
import { createToolArgumentProbe } from "./toolArgumentProbe";
import { createWebTools } from "./webTools";

const manualToolNameValidator = v.union(
  v.literal("create_new_firecrawl_session"),
  v.literal("browser_execute"),
  v.literal("browser_close"),
  v.literal("list_messages"),
  v.literal("search_messages"),
  v.literal("get_thread"),
  v.literal("send_message"),
  v.literal("reply_to_message"),
  v.literal("prepare_account_password"),
  v.literal("fill_account_password"),
  v.literal("record_authenticated_service_account"),
  v.literal("web_search"),
  v.literal("web_read"),
  v.literal("web_map"),
  v.literal("web_crawl"),
  v.literal("inspect_tool_arguments"),
);
const jsonValueSchema = z.json();
const manualOperationIdSchema = z.string().trim().min(1).max(200);

type ManualToolName = typeof manualToolNameValidator.type;
type Browser = ReturnType<typeof createBrowserHarness>;

const manualToolOutcomeValidator = v.union(
  v.object({ kind: v.literal("success"), output: v.string() }),
  v.object({ kind: v.literal("error"), error: v.string() }),
);

const manualToolResultValidator = v.object({
  toolCallId: v.string(),
  outcome: manualToolOutcomeValidator,
});

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

function usesAgentMailReadTool(toolName: ManualToolName) {
  return (
    toolName === "list_messages" || toolName === "search_messages" || toolName === "get_thread"
  );
}

function usesAgentMailWriteTool(toolName: ManualToolName) {
  return toolName === "send_message" || toolName === "reply_to_message";
}

function needsExistingBrowser(toolName: ManualToolName) {
  return (
    toolName === "browser_execute" ||
    toolName === "prepare_account_password" ||
    toolName === "fill_account_password" ||
    toolName === "record_authenticated_service_account"
  );
}

export const executeTool = action({
  args: {
    threadId: v.string(),
    toolName: manualToolNameValidator,
    input: v.string(),
    operationId: v.string(),
  },
  returns: manualToolResultValidator,
  handler: async (ctx, args) => {
    const runtime = await ctx.runQuery(internal.scout.manualState.runtimeContext, {
      threadId: args.threadId,
    });
    const operationId = manualOperationIdSchema.parse(args.operationId);
    const toolCallId = randomUUID();
    const input = parseManualToolInput(args.input);
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
    let currentBrowserSessionId = runtime.browserSession?._id ?? null;
    let output: JSONValue = null;
    let executionError: string | undefined;
    try {
      let selectedTools: ToolSet;
      if (usesAgentMailReadTool(args.toolName)) {
        const agentMailApiKey = requiredAgentMailApiKey(env.AGENTMAIL_API_KEY);
        agentMailClient = await createMCPClient({
          transport: {
            type: "http",
            url: "https://mcp.agentmail.to/mcp",
            headers: {
              "x-api-key": agentMailApiKey,
            },
          },
        });
        selectedTools = selectAgentMailTools(await agentMailClient.tools(), runtime.inboxId);
      } else if (usesAgentMailWriteTool(args.toolName)) {
        selectedTools = createAgentMailWriteTools(
          createAgentMailInboxClient({
            apiKey: requiredAgentMailApiKey(env.AGENTMAIL_API_KEY),
            inboxId: runtime.inboxId,
          }),
          { kind: "manual", operationId },
        );
      } else if (args.toolName === "inspect_tool_arguments") {
        selectedTools = { inspect_tool_arguments: createToolArgumentProbe() };
      } else if (
        args.toolName === "web_search" ||
        args.toolName === "web_read" ||
        args.toolName === "web_map" ||
        args.toolName === "web_crawl"
      ) {
        selectedTools = createWebTools();
      } else {
        if (args.toolName === "create_new_firecrawl_session" && runtime.browserSession) {
          throw new Error("This chat already has an open browser session");
        }
        browser = createBrowserHarness({
          profileName: runtime.profileName,
          onSessionCreated: async (session) => {
            const registered = await ctx.runMutation(internal.scout.browserSessions.open, {
              threadId: args.threadId,
              scoutId: runtime.scoutId,
              source: { kind: "manual" },
              ...session,
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
          onOperationSettled: async ({ toolCallId, outcome, clickCapture }) => {
            if (currentBrowserSessionId === null) {
              throw new Error("Browser session was not registered");
            }
            await ctx.runMutation(internal.scout.browserSessions.settleOperation, {
              sessionId: currentBrowserSessionId,
              toolCallId,
              outcome,
              clickCapture,
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
          runtime.browserSession &&
          (needsExistingBrowser(args.toolName) || args.toolName === "browser_close")
        ) {
          const persisted = runtime.browserSession;
          if (persisted.lifecycle.kind !== "active") {
            throw new Error("Active browser session not found");
          }
          const connection = await attachPersistedBrowserSession(browser, {
            providerSessionId: persisted.providerSessionId,
            cdpUrl: persisted.lifecycle.cdpUrl,
            interactiveLiveViewUrl: persisted.lifecycle.interactiveLiveViewUrl,
          });
          if (!connection) {
            await ctx.runMutation(internal.scout.browserSessions.close, {
              sessionId: persisted._id,
              providerDurationMs: null,
              creditsBilled: null,
            });
            throw new Error("The browser session has expired. Create a new Firecrawl session.");
          }
          if (
            connection.cdpUrl !== persisted.lifecycle.cdpUrl ||
            connection.interactiveLiveViewUrl !== persisted.lifecycle.interactiveLiveViewUrl
          ) {
            await ctx.runMutation(internal.scout.browserSessions.replaceConnection, {
              sessionId: persisted._id,
              cdpUrl: connection.cdpUrl,
              interactiveLiveViewUrl: connection.interactiveLiveViewUrl,
            });
          }
        } else if (needsExistingBrowser(args.toolName)) {
          throw new Error("Open a browser session before using it");
        }

        if (
          args.toolName === "prepare_account_password" ||
          args.toolName === "fill_account_password" ||
          args.toolName === "record_authenticated_service_account"
        ) {
          selectedTools = createAccountTools(ctx, {
            browser,
            scoutId: runtime.scoutId,
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
