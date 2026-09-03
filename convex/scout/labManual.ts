"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { validateTypes } from "@ai-sdk/provider-utils";
import type { Message } from "@convex-dev/agent";
import { randomUUID } from "node:crypto";
import { type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { findActiveBrowserSession } from "../taskHumanHandoffBrowser";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";
import { scoutAgent } from "./agent";
import {
  assertCredentialBrowserUrl,
  closeAgentMailBestEffort,
  decryptRuntimeManagedPassword,
} from "./labGeneration";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import { diagnosticMessage } from "./lib/redaction";
import { createToolArgumentProbe } from "./toolArgumentProbe";

const manualToolNameValidator = v.union(
  v.literal("create_new_firecrawl_session"),
  v.literal("browser_execute"),
  v.literal("browser_close"),
  v.literal("list_messages"),
  v.literal("search_messages"),
  v.literal("get_thread"),
  v.literal("fill_account_password"),
  v.literal("inspect_tool_arguments"),
);

type ManualToolName = typeof manualToolNameValidator.type;
type LabBrowser = ReturnType<typeof createLabBrowserHarness>;

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
  return toolName === "browser_execute" || toolName === "fill_account_password";
}

async function attachBrowser(
  browser: LabBrowser,
  providerSessionId: string,
  clearStaleSession: () => Promise<void>,
) {
  const active = await findActiveBrowserSession(providerSessionId);
  if (!active) {
    await clearStaleSession();
    throw new Error("The Lab browser session has expired. Create a new Firecrawl session.");
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
    const runtime = await ctx.runQuery(internal.scout.labManualState.runtimeContext, {
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
    let browser: LabBrowser | undefined;
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
      } else {
        if (args.toolName === "create_new_firecrawl_session" && runtime.providerSessionId) {
          throw new Error("This Lab thread already has an open browser session");
        }
        browser = createLabBrowserHarness({
          profileName: runtime.profileName,
          onSessionAvailable: async (providerSessionId) => {
            const registered = await ctx.runMutation(internal.scout.labBrowserSessions.open, {
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
              throw new Error("Lab browser session was not registered");
            }
            return await ctx.runMutation(internal.scout.labBrowserSessions.prepareOperation, {
              sessionId: currentBrowserSessionId,
              toolCallId,
              action,
            });
          },
          onOperationSettled: async ({ toolCallId, outcome }) => {
            if (currentBrowserSessionId === null) {
              throw new Error("Lab browser session was not registered");
            }
            await ctx.runMutation(internal.scout.labBrowserSessions.settleOperation, {
              sessionId: currentBrowserSessionId,
              toolCallId,
              outcome,
            });
          },
          onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.labBrowserSessions.close, {
              sessionId: currentBrowserSessionId,
              providerDurationMs: sessionDurationMs,
              creditsBilled,
            });
            currentBrowserSessionId = null;
          },
          onLiveViewAvailable: async (liveViewUrl) => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.labBrowserSessions.setLiveView, {
              sessionId: currentBrowserSessionId,
              liveViewUrl,
            });
          },
          onLiveViewClosed: async () => {
            if (currentBrowserSessionId === null) return;
            await ctx.runMutation(internal.scout.labBrowserSessions.clearLiveView, {
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
            await ctx.runMutation(internal.scout.labBrowserSessions.close, {
              sessionId: runtime.browserSessionId,
              providerDurationMs: null,
              creditsBilled: null,
            });
          });
        } else if (needsExistingBrowser(args.toolName)) {
          throw new Error("Open a browser session before using it");
        }

        if (args.toolName === "fill_account_password") {
          const credentials = await ctx.runQuery(
            internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
            { scoutId: runtime.scoutId },
          );
          if (credentials.length === 0) {
            throw new Error("This Scout has no managed password");
          }
          const activeBrowser = browser;
          selectedTools = {
            fill_account_password: createAccountPasswordFillTool(
              async ({ passwordTarget, passwordConfirmationTarget }, currentToolCallId) => {
                const currentUrl = await activeBrowser.actions.getPage("url");
                if (!currentUrl.success) {
                  throw new Error("The current browser URL could not be verified");
                }
                let currentHostname: string;
                try {
                  currentHostname = new URL(currentUrl.output).hostname.toLowerCase();
                } catch {
                  throw new Error("The current browser URL could not be verified");
                }
                const credential = credentials.find(
                  (candidate) => candidate.credentialHost === currentHostname,
                );
                if (!credential) {
                  throw new Error("This Scout has no managed password for the current login host");
                }
                assertCredentialBrowserUrl(currentUrl.output, credential.credentialHost);
                const passwordField = await activeBrowser.actions.getElementAttribute(
                  passwordTarget,
                  "type",
                );
                if (!passwordField.success) {
                  throw new Error("The configured password field could not be verified");
                }
                requirePasswordInputType(passwordField.output);
                if (passwordConfirmationTarget) {
                  const confirmationField = await activeBrowser.actions.getElementAttribute(
                    passwordConfirmationTarget,
                    "type",
                  );
                  if (!confirmationField.success) {
                    throw new Error(
                      "The configured password confirmation field could not be verified",
                    );
                  }
                  requirePasswordInputType(confirmationField.output);
                }
                let password: string;
                try {
                  password = decryptRuntimeManagedPassword(
                    credential,
                    runtime.scoutId,
                    env.SCOUT_CREDENTIAL_MASTER_KEY_V1,
                  );
                } catch {
                  throw new Error("Managed password fill is unavailable");
                }
                activeBrowser.actions.registerSensitiveValue(password);
                const result = await activeBrowser.actions.fillManagedPassword(
                  {
                    passwordTarget,
                    ...(passwordConfirmationTarget ? { passwordConfirmationTarget } : {}),
                  },
                  password,
                  currentToolCallId,
                );
                if (!result.success) {
                  throw new Error("The configured account password could not be filled");
                }
                return { filledFields: passwordConfirmationTarget ? 2 : 1 };
              },
            ),
          };
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
