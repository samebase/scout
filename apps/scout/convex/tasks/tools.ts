"use node";

import { createMCPClient } from "@ai-sdk/mcp";
import { asSchema } from "@ai-sdk/provider-utils";
import { tool, type ToolSet } from "ai";
import type { AgentToolParam } from "openai/resources/beta/agents/agents";
import { outdent } from "outdent";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { omitNullish } from "../../shared/omitNullish";
import { getRuntimeEnv } from "../runtimeEnv";
import { createBrowserHarness, selectAgentMailTools } from "../scout/browserTools";
import { restoreManagedPasswordRedaction } from "../scout/accountTools";
import { attachPersistedBrowserSession } from "../scout/browserSessionConnection";
import { createAgentMailWriteTools } from "../scout/agentMailTools";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "../scout/lib/agentMail";
import { createAgentsAccountTools } from "./accounts";
import { createWorkspaceTools } from "../scout/workspaceTools";
import { saveScreenshot } from "./screenshots";
import { MAX_TASK_SCREENSHOTS } from "./screenshotModel";
import { reviewChecksSchema } from "../../shared/reviewChecks";
import { createPlayTools } from "../scout/play";
import { taskBrowserBilling } from "./browserCredits";

export const handoffInput = z.object({ message: z.string().trim().min(1).max(2_000) });
const mailNames = new Set([
  "list_messages",
  "search_messages",
  "get_thread",
  "send_message",
  "reply_to_message",
]);

export async function runtimeTools(
  ctx: ActionCtx,
  session: Doc<"agentsApiSessions">,
  scout: Doc<"scouts">,
  requestedTool: string | null,
  purpose: Doc<"scoutChats">["purpose"],
) {
  const sessionId = session._id;
  let handle = session.browser;
  const beforeDispatch = async () => {
    const current = await ctx.runQuery(internal.tasks.sessions.runtime, { sessionId });
    if (current.session.state.kind !== "running" && current.session.state.kind !== "starting") {
      throw new Error("This session is no longer running");
    }
  };
  async function saveBrowser() {
    await ctx.runMutation(internal.tasks.sessions.update, { sessionId, browser: handle });
  }

  const browserBilling = taskBrowserBilling(ctx, sessionId);
  const browser = createBrowserHarness(
    {
      profileName: scout.firecrawl.profileName,
      beforeDispatch,
      captureScreenshot: async ({ toolCallId, note, take }) => {
        await beforeDispatch();
        if (!handle) throw new Error("Browser is not open");
        await ctx.runMutation(internal.tasks.browsers.admitOperation, {
          providerSessionId: handle.providerSessionId,
        });
        return await saveScreenshot(ctx, {
          sessionId,
          providerSessionId: handle.providerSessionId,
          toolCallId,
          note,
          take,
        });
      },
      onSessionCreated: async (created) => {
        handle = {
          providerSessionId: created.providerSessionId,
          cdpUrl: created.cdpUrl,
          ...omitNullish({ selectedTabId: created.selectedTabId }),
          interactiveLiveViewUrl: created.interactiveLiveViewUrl,
          liveViewUrl: null,
          currentUrl: null,
        };
        await ctx.runMutation(internal.tasks.browsers.open, {
          sessionId,
          browser: handle,
        });
        return { captureOperations: true };
      },
      onLiveViewAvailable: async (liveViewUrl) => {
        if (!handle) throw new Error("Browser was not registered");
        handle = { ...handle, liveViewUrl };
        await saveBrowser();
      },
      onInteractiveLiveViewAvailable: async (interactiveLiveViewUrl) => {
        if (!handle) throw new Error("Browser was not registered");
        handle = { ...handle, interactiveLiveViewUrl };
        await saveBrowser();
      },
      onOperationPrepared: async (operation) => {
        await beforeDispatch();
        if (!handle) throw new Error("Browser was not registered");
        return await ctx.runMutation(internal.tasks.browsers.prepareOperation, {
          providerSessionId: handle.providerSessionId,
          ...operation,
        });
      },
      onOperationSettled: async ({ outcome, selectedTabId, toolCallId, clickCapture }) => {
        if (!handle) throw new Error("Browser was not registered");
        await ctx.runMutation(internal.tasks.browsers.settleOperation, {
          providerSessionId: handle.providerSessionId,
          outcome,
          toolCallId,
          clickCapture,
        });
        const currentUrl =
          outcome.kind === "applied" || outcome.kind === "applied_snapshot_failed"
            ? (outcome.telemetry.after.tabs.find((tab) => tab.tabId === selectedTabId)?.url ?? null)
            : null;
        handle = { ...handle, ...omitNullish({ selectedTabId }), currentUrl };
        await saveBrowser();
      },
      onSessionClosed: async ({ sessionDurationMs, creditsBilled }) => {
        if (!handle) throw new Error("Browser was not registered");
        await ctx.runMutation(internal.tasks.browsers.close, {
          providerSessionId: handle.providerSessionId,
          providerDurationMs: sessionDurationMs,
          creditsBilled,
        });
        handle = null;
        browserBilling.closed();
      },
    },
    browserBilling.dependencies,
  );

  const createSessionTool = browser.tools.create_new_firecrawl_session;
  const createSessionExecute = createSessionTool.execute;
  if (!createSessionExecute) throw new Error("Browser session creation tool is unavailable");
  const createSessionToolWithBilling = {
    ...createSessionTool,
    execute: async (...args: Parameters<typeof createSessionExecute>) => {
      try {
        return await createSessionExecute(...args);
      } catch (error) {
        await browserBilling.failedOpen(error);
        throw error;
      }
    },
  };

  const credentials = await ctx.runQuery(
    internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
    { scoutId: scout._id },
  );
  restoreManagedPasswordRedaction({ browser, credentials, scoutId: scout._id });

  let mailClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  const tools: ToolSet = {
    ...browser.tools,
    create_new_firecrawl_session: createSessionToolWithBilling,
    list_screenshots: tool({
      description: outdent`
        List this task's saved screenshots in capture order, with IDs, notes, page URLs,
        and capture status. Use their IDs when saving a walkthrough. Images remain in
        storage; this returns references and metadata.
      `,
      inputSchema: z.object({}),
      execute: async () => {
        await beforeDispatch();
        return await ctx.runQuery(internal.tasks.walkthrough.listForAgent, { sessionId });
      },
    }),
    save_walkthrough: tool({
      description: outdent`
        Save this task's illustrated result using existing screenshot IDs. Lead the summary
        with the requested outcome and what you verified, in one or two short sentences.
        Each section explains an observed step,
        result, or problem and references 1–3 screenshots from this task. The section order
        is the reading order. Omit repetitive setup and distinguish findings from assumptions.
        This replaces the previous walkthrough; it does not end the task.

        Include 1–10 concrete checks of the requested behavior, each with a short explanation.
        Use passed for verified success, failed for an observed product failure, and untested
        for behavior you could not verify. A paywall, missing access, or a Scout/browser-service
        error leaves that behavior untested; it does not establish a product failure.
        Keep checks at the task level, such as saving a project or exporting a file.
        Do not count navigation, screenshots, or other setup as successful product checks.
      `,
      inputSchema: z.object({
        summary: z.string().trim().min(1).max(2000),
        checks: reviewChecksSchema,
        sections: z
          .array(
            z.object({
              heading: z.string().trim().min(1).max(120),
              explanation: z.string().trim().min(1).max(2000),
              captureIds: z.array(z.string()).min(1).max(3),
            }),
          )
          .min(1)
          .max(MAX_TASK_SCREENSHOTS),
      }),
      execute: async (content) => {
        await beforeDispatch();
        await ctx.runMutation(internal.tasks.walkthrough.save, { sessionId, ...content });
        return { saved: true, sections: content.sections.length };
      },
    }),
    ...createWorkspaceTools(
      ctx,
      { target: { kind: "agent_session", sessionId }, userId: session.userId },
      beforeDispatch,
    ),
    ...createAgentsAccountTools(ctx, { sessionId, scout, browser }),
    request_browser_handoff: tool({
      description: outdent`
        Pause for the user to complete a browser step you cannot perform, such as a
        CAPTCHA. Explain what they need to do. The user receives browser controls on
        this session page; execution resumes when they return control.
      `,
      inputSchema: handoffInput,
    }),
  };

  if (purpose.kind === "review") {
    tools["set_review_site"] = tool({
      description: outdent`
        Identify the main site this review is about. Supply its exact hostname,
        such as samebase.com. Returns the saved primarySite. Once identified,
        only the review owner can change it.
      `,
      inputSchema: z.object({ site: z.string() }),
      execute: async ({ site }) =>
        ctx.runMutation(internal.scout.reviewSites.identify, {
          sessionId,
          site,
        }),
    });
  }

  if (purpose.kind === "play") {
    Object.assign(
      tools,
      createPlayTools(async (step) => {
        await beforeDispatch();
        await ctx.runMutation(internal.scout.chats.setTaskActivityStep, { sessionId, step });
      }),
    );
  }

  try {
    if (
      handle &&
      requestedTool !== null &&
      requestedTool !== "bash" &&
      requestedTool !== "set_review_site" &&
      requestedTool !== "set_activity_step" &&
      !mailNames.has(requestedTool)
    ) {
      const connection = await attachPersistedBrowserSession(browser, handle);
      if (!connection)
        await ctx.runMutation(internal.tasks.browsers.close, {
          providerSessionId: handle.providerSessionId,
          providerDurationMs: null,
          creditsBilled: null,
        });
      handle = connection ? { ...handle, ...connection } : null;
      await saveBrowser();
    }
    if (requestedTool === null || mailNames.has(requestedTool)) {
      const apiKey = requiredAgentMailApiKey(getRuntimeEnv("AGENTMAIL_API_KEY"));
      mailClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.agentmail.to/mcp",
          headers: { "x-api-key": apiKey },
        },
      });
      let page = await mailClient.listTools();
      const definitions = [...page.tools];
      while (page.nextCursor != null) {
        page = await mailClient.listTools({ params: { cursor: page.nextCursor } });
        definitions.push(...page.tools);
      }
      Object.assign(
        tools,
        selectAgentMailTools(
          mailClient.toolsFromDefinitions({ ...page, tools: definitions }),
          scout.agentMail.inboxId,
          beforeDispatch,
        ),
        createAgentMailWriteTools(
          createAgentMailInboxClient({ apiKey, inboxId: scout.agentMail.inboxId }),
          {
            kind: "model",
            promptMessageId: session._id,
            beforeDispatch,
          },
        ),
      );
    }
    return {
      tools,
      browser,
      dispose: async () => {
        try {
          await browser.disconnect();
        } finally {
          await mailClient?.close();
        }
      },
    };
  } catch (error) {
    try {
      await browser.disconnect();
    } finally {
      await mailClient?.close();
    }
    throw error;
  }
}

export async function functionDefinitions(tools: ToolSet): Promise<AgentToolParam[]> {
  return await Promise.all(
    Object.entries(tools).map(
      async ([name, definition]): Promise<AgentToolParam> => ({
        type: "function",
        name,
        description:
          typeof definition.description === "function"
            ? definition.description({ context: undefined })
            : (definition.description ?? name),
        parameters: await asSchema(definition.inputSchema).jsonSchema,
      }),
    ),
  );
}
