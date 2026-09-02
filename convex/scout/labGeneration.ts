"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount, type LanguageModelUsage } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env, internalAction, type ActionCtx } from "../_generated/server";
import { SCOUT_AGENT_INSTRUCTIONS, scoutAgent } from "./agent";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";
import {
  decideTaskStep,
  immediatelyPrecedingToolError,
  immediatelyPrecedingToolResult,
  type TaskLoopState,
} from "./taskLoop";
import { requireOwnedAgentThread } from "./labAccess";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import {
  beginHumanHandoff,
  createHumanHandoffTool,
  type HumanHandoffCallbacks,
} from "./humanHandoffTool";
import {
  createHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
  humanHandoffOrigin,
  humanHandoffUrl,
} from "./lib/humanHandoffAccess";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  decryptCredential,
} from "./credentialCrypto";
import { diagnosticMessage } from "./lib/redaction";
import {
  scoutLanguageModel,
  scoutModelValidator,
  type ScoutModel,
  type ScoutTokenUsage,
} from "./models";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";
import { createAttemptResolutionTool } from "./attemptResolutionTool";

const MAX_GENERATION_STEPS = 30;
const AGENT_MAIL_CLOSE_TIMEOUT_MS = 1_000;
const HANDOFF_RESOLUTION_INSTRUCTIONS =
  "Act only as the final judge for this Task attempt. Review the objective and evidence in the conversation, then call resolve_attempt as your final action. It closes any open browser and persists the verdict. Choose completed only when the objective is achieved with sufficient evidence; otherwise choose blocked. Give a short evidence-based conclusion.";

type LabBrowser = ReturnType<typeof createLabBrowserHarness>;
type LabBrowserUsage = Awaited<ReturnType<LabBrowser["close"]>>;
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
      ? `${diagnosticMessage(generationResult.error)}; browser cleanup: ${diagnosticMessage(cleanupFailure)}`
      : cleanupFailure
        ? `Browser cleanup failed: ${diagnosticMessage(cleanupFailure)}`
        : diagnosticMessage(terminalError);

  return generationResult.usage === undefined
    ? { failure, terminalError }
    : { failure, terminalError, usage: generationResult.usage };
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
  return `This Lab thread is bound to a Scout with first name ${JSON.stringify(scout.websiteIdentity.firstName)}, last name ${JSON.stringify(scout.websiteIdentity.lastName)}, display name ${JSON.stringify(scout.displayName)}, and email address ${JSON.stringify(scout.agentMail.address)}. This identity and inbox belong to the Scout, not to the current worker model. Use them directly for the requested work, including website forms and email verification. When the task authorizes account creation, choose a username if needed. Never invent, expose, or enter a password through generic browser tools. Use fill_account_password when it is available; if it is unavailable, report that no recoverable credential is configured. Use only this Scout identity for website accounts and email evidence in this thread.`;
}

export function assertCredentialBrowserUrl(value: string, credentialHost: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("The current browser URL could not be verified for credential entry");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    hostname !== credentialHost
  ) {
    throw new Error("The account password can only be filled on its exact configured login host");
  }
}

type RuntimeManagedCredential = {
  credentialReference: string;
  identifier: string;
  serviceDomain: string;
  credentialHost: string;
  keyFingerprint: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
};

type RuntimeServiceAccount = {
  serviceAccountId: string;
  serviceName: string;
  serviceDomain: string;
  identifier: string;
  loginMethod:
    | { kind: "managed_password"; credentialHost: string; createdAt: number }
    | { kind: "oauth"; providerAccountId: string };
};

export function managedCredentialInstructions(
  credentials: ReadonlyArray<Pick<RuntimeManagedCredential, "credentialHost" | "identifier">>,
) {
  if (credentials.length === 0) {
    return "This Scout has no managed passwords. Do not invent, request, expose, or enter a password. You may use an already authenticated browser state. If authentication requires a password, explain the limitation.";
  }
  const available = credentials
    .map((credential) => `- ${credential.credentialHost}: ${JSON.stringify(credential.identifier)}`)
    .join("\n");
  return `This Scout has managed credential capabilities for these exact HTTPS login hosts:\n${available}\nThe capabilities expose no password values. Fill identifiers and other non-secret fields normally. On one of those exact hosts, call fill_account_password for visible password fields. Trusted code chooses the credential from the current URL and fills it without returning it. Submit separately. Never invent, request, inspect, repeat, or put a password into a generic browser tool.`;
}

export function serviceAccountLoginInstructions(accounts: ReadonlyArray<RuntimeServiceAccount>) {
  if (accounts.length === 0) {
    return "This Scout has no registered service accounts.";
  }
  const byId = new Map(accounts.map((account) => [account.serviceAccountId, account]));
  const inventory = accounts
    .map((account) => {
      if (account.loginMethod.kind === "managed_password") {
        return `- ${account.serviceName} at ${account.serviceDomain} as ${JSON.stringify(account.identifier)}: managed password`;
      }
      const provider = byId.get(account.loginMethod.providerAccountId);
      if (!provider) {
        throw new Error("OAuth login method references a missing Scout service account");
      }
      return `- ${account.serviceName} at ${account.serviceDomain} as ${JSON.stringify(account.identifier)}: OAuth through ${provider.serviceName} at ${provider.serviceDomain} as ${JSON.stringify(provider.identifier)}`;
    })
    .join("\n");
  return `This Scout's registered service-account login methods are:\n${inventory}\nWhen recording an authenticated account, report the method actually used. For OAuth, provide the exact provider service domain and identifier shown above so trusted code can bind the relationship to that account.`;
}

export function decryptRuntimeManagedPassword(
  credential: RuntimeManagedCredential,
  scoutId: string,
  encodedMasterKey: string | undefined,
) {
  const key = decodeCredentialMasterKey(encodedMasterKey);
  try {
    if (credentialKeyFingerprint(key) !== credential.keyFingerprint) {
      throw new Error("Scout credential key does not match configured version");
    }
    return decryptCredential(
      {
        nonce: credential.nonce,
        ciphertext: credential.ciphertext,
        authenticationTag: credential.authenticationTag,
      },
      key,
      {
        credentialReference: credential.credentialReference,
        scoutId,
        serviceDomain: credential.serviceDomain,
        credentialHost: credential.credentialHost,
        identifier: credential.identifier,
        keyFingerprint: credential.keyFingerprint,
      },
    );
  } finally {
    key.fill(0);
  }
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

async function generateHandoffContinuation(
  ctx: ActionCtx,
  args: {
    threadId: string;
    userId: Id<"users">;
    promptMessageId: string;
    model: ScoutModel;
  },
) {
  let resolutionPersisted = false;
  let accumulatedUsage: ScoutTokenUsage | undefined;
  try {
    await requireOwnedAgentThread(ctx, args.threadId, args.userId);
    const streamErrors = createStreamErrorCapture();
    const streamResult = await scoutAgent.streamText(
      ctx,
      { threadId: args.threadId, userId: args.userId },
      {
        promptMessageId: args.promptMessageId,
        model: scoutLanguageModel(args.model),
        instructions: HANDOFF_RESOLUTION_INSTRUCTIONS,
        tools: {
          resolve_attempt: createAttemptResolutionTool(async (resolution) => {
            const result = await ctx.runMutation(internal.tasks.resolveAttempt, {
              promptMessageId: args.promptMessageId,
              state: resolution,
            });
            resolutionPersisted = true;
            return result;
          }),
        },
        stopWhen: isStepCount(1),
        onError: streamErrors.onError,
        onStepEnd: ({ usage }) => {
          accumulatedUsage = addScoutTokenUsage(accumulatedUsage, tokenUsage(usage));
        },
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
    streamErrors.throwIfCaptured();
    if (!resolutionPersisted) {
      throw new Error("Scout ended without persisting the Attempt conclusion");
    }
    await ctx.runMutation(internal.scout.turns.complete, {
      promptMessageId: args.promptMessageId,
      usage: accumulatedUsage ?? tokenUsage(await streamResult.totalUsage),
    });
    return null;
  } catch (error) {
    let terminalError = error;
    try {
      await ctx.runMutation(internal.scout.turns.fail, {
        promptMessageId: args.promptMessageId,
        failure: diagnosticMessage(error),
        ...(accumulatedUsage === undefined ? {} : { usage: accumulatedUsage }),
      });
    } catch (persistenceError) {
      terminalError = new AggregateError(
        [error, persistenceError],
        "Handoff continuation failed and its failure state could not be recorded",
      );
    }
    throw terminalError;
  }
}

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    promptMessageId: v.string(),
    model: scoutModelValidator,
    mode: v.union(
      v.object({ kind: v.literal("normal") }),
      v.object({ kind: v.literal("handoff_continuation") }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.scout.turns.start, {
      promptMessageId: args.promptMessageId,
    });
    if (!started) {
      return null;
    }
    if (args.mode.kind === "handoff_continuation") {
      return await generateHandoffContinuation(ctx, args);
    }

    let agentMailClient: MCPClient | undefined;
    let browser: LabBrowser | undefined;
    let browserSessionId: Id<"taskBrowserSessions"> | null = null;
    let interactiveLiveViewUrl: string | null = null;
    let humanHandoffWaiting = false;
    let isTaskTurn = false;
    let attemptResolutionPersisted = false;
    let generationResult: GenerationResult;
    let accumulatedUsage: ScoutTokenUsage | undefined;

    try {
      await requireOwnedAgentThread(ctx, args.threadId, args.userId);
      const runtimeContext = await ctx.runQuery(internal.tasks.runtimeContext, {
        promptMessageId: args.promptMessageId,
      });
      if (runtimeContext.userId !== args.userId) throw new Error("Scout turn owner is invalid");
      const scoutId = runtimeContext.scoutId;
      const scout = await ctx.runQuery(internal.scout.scouts.getRuntimeIdentity, { scoutId });
      if (!scout || scout.status !== "active") {
        throw new Error("Active Scout not found");
      }
      isTaskTurn = runtimeContext.kind === "task";
      const runtimeCredentials = await ctx.runQuery(
        internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
        { scoutId },
      );
      const runtimeServiceAccounts = await ctx.runQuery(
        internal.scout.serviceAccounts.listRuntimeForScout,
        { scoutId },
      );
      const browserProfileName =
        runtimeContext.kind === "task"
          ? runtimeContext.browserProfile.kind === "scout"
            ? runtimeContext.browserProfile.profileName
            : undefined
          : scout.firecrawl.profileName;
      browser = createLabBrowserHarness({
        ...(browserProfileName === undefined ? {} : { profileName: browserProfileName }),
        ...(isTaskTurn
          ? {
              onSessionAvailable: async (sessionId: string) => {
                const registered = await ctx.runMutation(internal.tasks.setBrowserSession, {
                  promptMessageId: args.promptMessageId,
                  providerSessionId: sessionId,
                });
                browserSessionId = registered.browserSessionId;
                return { captureOperations: registered.captureOperations };
              },
              onOperationPrepared: async ({ action, toolCallId }) => {
                if (browserSessionId === null) {
                  throw new Error("Task browser session was not registered");
                }
                return await ctx.runMutation(internal.tasks.prepareBrowserOperation, {
                  sessionId: browserSessionId,
                  toolCallId,
                  action,
                });
              },
              onOperationSettled: async ({ toolCallId, outcome }) => {
                if (browserSessionId === null) {
                  throw new Error("Task browser session was not registered");
                }
                await ctx.runMutation(internal.tasks.settleBrowserOperation, {
                  sessionId: browserSessionId,
                  toolCallId,
                  outcome,
                });
              },
              onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
                if (browserSessionId === null) return;
                await ctx.runMutation(internal.tasks.closeBrowserSessionRecord, {
                  sessionId: browserSessionId,
                  providerDurationMs: sessionDurationMs,
                  creditsBilled,
                });
              },
              onLiveViewAvailable: async (liveViewUrl: string) => {
                if (browserSessionId === null) return;
                await ctx.runMutation(internal.tasks.setLiveView, {
                  sessionId: browserSessionId,
                  liveViewUrl,
                });
              },
              onInteractiveLiveViewAvailable: async (url: string) => {
                interactiveLiveViewUrl = url;
              },
              onLiveViewClosed: async () => {
                interactiveLiveViewUrl = null;
                if (browserSessionId === null) return;
                await ctx.runMutation(internal.tasks.clearLiveView, {
                  sessionId: browserSessionId,
                });
              },
            }
          : {}),
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
      const activeBrowser = browser;
      if (!activeBrowser) throw new Error("Browser harness was not initialized");
      const humanHandoffCallbacks: HumanHandoffCallbacks<Id<"taskHumanHandoffs">> | null =
        isTaskTurn
          ? {
              request: async (reason) => {
                if (interactiveLiveViewUrl === null) {
                  throw new Error(
                    "The current browser session has no interactive human-takeover link",
                  );
                }
                const accessToken = createHumanHandoffAccessToken();
                const appOrigin = humanHandoffOrigin(env.SITE_URL);
                const request = await ctx.runMutation(internal.taskHumanHandoffs.request, {
                  promptMessageId: args.promptMessageId,
                  reason,
                  accessTokenHash: hashHumanHandoffAccessToken(accessToken),
                });
                return {
                  ...request,
                  handoffUrl: humanHandoffUrl(appOrigin, request.handoffId, accessToken),
                };
              },
              failDelivery: async (handoffId) =>
                await ctx.runMutation(internal.taskHumanHandoffs.failDelivery, { handoffId }),
              onWaiting: () => {
                humanHandoffWaiting = true;
              },
            }
          : null;
      const humanHandoffTools = humanHandoffCallbacks
        ? {
            request_human_help: createHumanHandoffTool(humanHandoffCallbacks),
          }
        : {};
      const serviceAccountTools = isTaskTurn
        ? {
            record_authenticated_service_account: createServiceAccountRecordingTool(
              async ({ accountAccess, identityText, loginMethod, sessionControlText }) => {
                const [identity, sessionControl, currentUrl] = await Promise.all([
                  activeBrowser.actions.getElement({
                    kind: "text",
                    text: identityText,
                    exact: true,
                  }),
                  activeBrowser.actions.getElement({
                    kind: "text",
                    text: sessionControlText,
                    exact: true,
                  }),
                  activeBrowser.actions.getPage("url"),
                ]);
                if (!identity.success || !sessionControl.success || !currentUrl.success) {
                  throw new Error(
                    "The authenticated account evidence could not be read from the current page",
                  );
                }
                return await ctx.runMutation(
                  internal.scout.serviceAccounts.recordAuthenticatedFromTask,
                  {
                    promptMessageId: args.promptMessageId,
                    accountAccess,
                    loginMethod,
                    observedUrl: currentUrl.output,
                    visibleIdentity: identity.output,
                    visibleSessionControl: sessionControl.output,
                  },
                );
              },
            ),
          }
        : {};
      const accountPasswordTools =
        runtimeCredentials.length > 0
          ? {
              fill_account_password: createAccountPasswordFillTool(
                async ({ passwordTarget, passwordConfirmationTarget }, toolCallId) => {
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
                  const runtimeCredential = runtimeCredentials.find(
                    (credential) => credential.credentialHost === currentHostname,
                  );
                  if (!runtimeCredential) {
                    throw new Error(
                      "This Scout has no managed password for the current login host",
                    );
                  }
                  assertCredentialBrowserUrl(currentUrl.output, runtimeCredential.credentialHost);
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
                      runtimeCredential,
                      scoutId,
                      env.SCOUT_CREDENTIAL_MASTER_KEY_V1,
                    );
                  } catch {
                    throw new Error("Managed password fill is unavailable");
                  }
                  activeBrowser.actions.registerSensitiveValue(password);
                  const passwordResult = await activeBrowser.actions.fillManagedPassword(
                    {
                      passwordTarget,
                      ...(passwordConfirmationTarget ? { passwordConfirmationTarget } : {}),
                    },
                    password,
                    toolCallId,
                  );
                  if (!passwordResult.success) {
                    throw new Error("The configured account password could not be filled");
                  }
                  return { filledFields: passwordConfirmationTarget ? 2 : 1 };
                },
              ),
            }
          : {};
      const attemptResolutionTools = isTaskTurn
        ? {
            resolve_attempt: createAttemptResolutionTool(async (resolution) => {
              await activeBrowser.close();
              const result = await ctx.runMutation(internal.tasks.resolveAttempt, {
                promptMessageId: args.promptMessageId,
                state: resolution,
              });
              attemptResolutionPersisted = true;
              return result;
            }),
          }
        : {};

      const browserTools = isTaskTurn
        ? {
            browser_open: browser.tools.browser_open,
            browser_execute: browser.tools.browser_execute,
          }
        : browser.tools;

      const tools = {
        ...browserTools,
        ...agentMailTools,
        ...humanHandoffTools,
        ...accountPasswordTools,
        ...serviceAccountTools,
        ...attemptResolutionTools,
      };
      let taskLoopState: TaskLoopState = "working";
      const passwordInstructions = managedCredentialInstructions(runtimeCredentials);
      const loginInstructions = serviceAccountLoginInstructions(runtimeServiceAccounts);
      const taskInstructions =
        runtimeContext.kind === "lab"
          ? ""
          : `\n\nYou are working on an operator-defined Task for ${JSON.stringify(runtimeContext.product.name)}. Its primary URL is ${JSON.stringify(runtimeContext.product.primaryUrl)} and product domain is ${JSON.stringify(runtimeContext.product.domain)}. The attempt uses ${runtimeContext.browserProfile.kind === "fresh" ? "a fresh browser profile" : `the persistent Scout browser profile ${JSON.stringify(runtimeContext.browserProfile.profileName)}`}. Decide the next useful actions from the current operator message, the existing thread, and visible product state; do not force the work into a predefined testing workflow. Use browser_execute to write ordinary Playwright JavaScript against the provided page object. Prefer semantic locators. Use the accessibility snapshot returned by each call as your default observation, and combine the checks needed to identify and perform one coherent next step instead of making separate exploratory calls. As soon as you verify an authenticated account menu, call record_authenticated_service_account with a visible known Scout username or email—not a team or workspace name—and a visible Sign out or Log out control while the browser is still open; do this before optional onboarding so the Scout inventory reflects the account even if later work fails. If a CAPTCHA or another strictly human-only check blocks progress, call request_human_help instead of attempting to solve or bypass it. That tool sends a durable handoff and pauses this Turn; do not poll or keep working after it. When the Task is complete or cannot progress, call resolve_attempt as your final action. It closes any open browser and persists completed or blocked with a concise evidence-based conclusion. Do not merely describe the result in prose.`;
      const instructions = `${SCOUT_AGENT_INSTRUCTIONS}\n\n${scoutWebsiteIdentityInstructions(scout)}\n\n${passwordInstructions}\n\n${loginInstructions}${taskInstructions}`;
      const streamErrors = createStreamErrorCapture();
      const streamResult = await scoutAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: scoutLanguageModel(args.model),
          instructions,
          tools,
          stopWhen: isStepCount(MAX_GENERATION_STEPS),
          onError: streamErrors.onError,
          onStepEnd: ({ usage }) => {
            accumulatedUsage = addScoutTokenUsage(accumulatedUsage, tokenUsage(usage));
          },
          ...(isTaskTurn
            ? {
                prepareStep: async ({ steps }) => {
                  const decision = decideTaskStep({
                    state: taskLoopState,
                    previousToolError: immediatelyPrecedingToolError(steps),
                    previousToolResult: immediatelyPrecedingToolResult(steps),
                  });
                  taskLoopState = decision.nextState;
                  switch (decision.kind) {
                    case "request_human_help":
                      if (humanHandoffCallbacks === null) {
                        throw new Error("Human help is unavailable outside a Task turn");
                      }
                      await beginHumanHandoff(
                        humanHandoffCallbacks,
                        "The live browser reached a human-only checkpoint.",
                      );
                      taskLoopState = "final";
                      return {
                        activeTools: [] as const,
                        toolChoice: "none" as const,
                        instructions: `${instructions}\n\nHuman help was requested successfully. The browser remains open under the durable handoff. Do not investigate, close the browser, or resolve the attempt. Briefly state that Scout is paused and will resume after the operator returns control.`,
                      };
                    case "resolve_attempt":
                      return {
                        activeTools: ["resolve_attempt"] as const,
                        instructions: HANDOFF_RESOLUTION_INSTRUCTIONS,
                      };
                    case "resolution_failed":
                      throw new Error("Scout could not persist the Attempt conclusion");
                    case "final":
                      return {
                        activeTools: [] as const,
                        toolChoice: "none" as const,
                        instructions:
                          decision.humanHelpOutcome === "waiting"
                            ? `${instructions}\n\nHuman help was requested successfully. The browser remains open under the durable handoff. Do not investigate, close the browser, or resolve the attempt. Briefly state that Scout is paused and will resume after the operator returns control.`
                            : `${instructions}\n\nThe bounded browser phase is over. Do not investigate further. Briefly report what you accomplished, what remains uncertain, and what the operator should try next.`,
                      };
                    case "none":
                      return undefined;
                  }
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
    let browserUsage: LabBrowserUsage = undefined;
    let cleanupFailure: unknown;
    if (!preserveBrowserForHandoff) {
      try {
        browserUsage = await closeGenerationBrowser(browser);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    let completionFailure: unknown;
    if (isTaskTurn && !humanHandoffWaiting && !attemptResolutionPersisted && !cleanupFailure) {
      try {
        await ctx.runMutation(internal.tasks.resolveAttempt, {
          promptMessageId: args.promptMessageId,
          state: {
            kind: "blocked",
            conclusion: "Scout ended without resolving this Attempt.",
          },
        });
        attemptResolutionPersisted = true;
      } catch (error) {
        completionFailure = error;
      }
    }
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
