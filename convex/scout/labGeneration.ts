"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount, type LanguageModelUsage } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env, internalAction } from "../_generated/server";
import { parseClaimTestOutcome } from "../claimTestRunModel";
import { SCOUT_AGENT_INSTRUCTIONS, scoutAgent } from "./agent";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";
import {
  createSingleUseHumanHandoffArm,
  decideClaimTestStep,
  humanHandoffOutcome,
  immediatelyPrecedingToolResult,
  type ClaimTestLoopState,
} from "./claimTestLoop";
import { requireOwnedAgentThread } from "./labAccess";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import { createHumanHandoffTool } from "./humanHandoffTool";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  decryptCredential,
} from "./credentialCrypto";
import { diagnosticMessage } from "./lib/redaction";
import { scoutLanguageModel, scoutModelValidator, type ScoutTokenUsage } from "./models";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const MAX_GENERATION_STEPS = 24;
const CLAIM_TEST_CLOSE_STEP = 18;
const CLAIM_TEST_HANDOFF_CLOSE_STEP = MAX_GENERATION_STEPS - 2;
const AGENT_MAIL_CLOSE_TIMEOUT_MS = 1_000;

type LabBrowser = ReturnType<typeof createLabBrowserHarness>;
type LabBrowserUsage = Awaited<ReturnType<LabBrowser["close"]>>;
type GenerationResult =
  | {
      kind: "completed";
      usage: ScoutTokenUsage;
      claimTestOutcome?: NonNullable<ReturnType<typeof parseClaimTestOutcome>>;
    }
  | { kind: "failed"; error: unknown };

type ClaimTestGenerationStep = {
  readonly text: string;
  readonly toolResults: readonly (
    | {
        readonly toolName: string;
        readonly output: unknown;
      }
    | undefined
  )[];
};

export const EXPIRED_HUMAN_HANDOFF_RESULT = `Verdict: Inconclusive

The required human verification was not completed within five minutes, so this claim could not be tested.`;

function needsExpiredHumanHandoffResult(steps: readonly ClaimTestGenerationStep[]) {
  const expired = steps.some((step) =>
    step.toolResults.some(
      (result) =>
        result?.toolName === "request_human_help" &&
        humanHandoffOutcome(result.output) === "expired",
    ),
  );
  if (!expired) return false;
  return !/^\s*Verdict:\s*Inconclusive\b/i.test(steps.at(-1)?.text ?? "");
}

export async function persistExpiredHumanHandoffResult(
  steps: readonly ClaimTestGenerationStep[],
  persist: (message: { role: "assistant"; content: string }) => Promise<void>,
) {
  if (!needsExpiredHumanHandoffResult(steps)) return false;
  await persist({ role: "assistant", content: EXPIRED_HUMAN_HANDOFF_RESULT });
  return true;
}

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

export function managedCredentialInstructions(
  credential: Pick<RuntimeManagedCredential, "credentialHost" | "identifier"> | null,
) {
  if (!credential) {
    return "No managed password is configured for this experiment. Do not create an account, invent or enter a password, or ask the operator for one. You may use an already authenticated browser state. If authentication is required and none exists, stop that path and explain the limitation.";
  }
  return `You have a managed credential capability for exact login host ${JSON.stringify(credential.credentialHost)} with identifier ${JSON.stringify(credential.identifier)}. The capability exposes no password value. Fill the identifier and any required non-secret fields normally. When a visible password field is present on that exact HTTPS host, call fill_account_password with its element ref and include the confirmation-field ref when one is present. The trusted tool verifies the refs and fills the stored password without returning it. Submit the form separately after the fill succeeds. Never invent, request, inspect, repeat, or place a password in browser_fill, browser_type, or browser_press.`;
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
    let browserSessionId: Id<"claimTestBrowserSessions"> | null = null;
    let interactiveLiveViewUrl: string | null = null;
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
      const claimTestContext = await ctx.runQuery(internal.claimTests.generationContext, {
        promptMessageId: args.promptMessageId,
      });
      const isClaimTestGeneration = claimTestContext !== null;
      const runtimeCredential = claimTestContext?.serviceAccountId
        ? await ctx.runQuery(internal.scout.serviceAccountCredentials.getRuntimeCredential, {
            serviceAccountId: claimTestContext.serviceAccountId,
          })
        : null;
      browser = createLabBrowserHarness({
        ...(claimTestContext?.browserProfile.kind === "fresh"
          ? {}
          : {
              profileName:
                claimTestContext?.browserProfile.profileName ?? scout.firecrawl.profileName,
            }),
        onSessionAvailable: async (sessionId) => {
          const registered = await ctx.runMutation(internal.claimTests.setBrowserSession, {
            promptMessageId: args.promptMessageId,
            providerSessionId: sessionId,
          });
          browserSessionId = registered.browserSessionId;
          return { captureOperations: registered.captureOperations };
        },
        onOperationPrepared: async ({ action, toolCallId }) => {
          if (browserSessionId === null) {
            throw new Error("Claim test browser session was not registered");
          }
          return await ctx.runMutation(internal.claimTests.prepareBrowserOperation, {
            sessionId: browserSessionId,
            toolCallId,
            action,
          });
        },
        onOperationSettled: async ({ toolCallId, outcome }) => {
          if (browserSessionId === null) {
            throw new Error("Claim test browser session was not registered");
          }
          await ctx.runMutation(internal.claimTests.settleBrowserOperation, {
            sessionId: browserSessionId,
            toolCallId,
            outcome,
          });
        },
        onSessionClosed: async ({ creditsBilled, sessionDurationMs }) => {
          if (browserSessionId === null) return;
          await ctx.runMutation(internal.claimTests.closeBrowserSessionRecord, {
            sessionId: browserSessionId,
            providerDurationMs: sessionDurationMs,
            creditsBilled,
          });
        },
        onLiveViewAvailable: async (liveViewUrl) => {
          if (browserSessionId === null) return;
          await ctx.runMutation(internal.claimTests.setLiveView, {
            sessionId: browserSessionId,
            liveViewUrl,
          });
        },
        onInteractiveLiveViewAvailable: async (url) => {
          interactiveLiveViewUrl = url;
        },
        onLiveViewClosed: async () => {
          interactiveLiveViewUrl = null;
          if (browserSessionId === null) return;
          await ctx.runMutation(internal.claimTests.clearLiveView, {
            sessionId: browserSessionId,
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
      const humanHandoffArm = createSingleUseHumanHandoffArm();
      const humanHandoffTools = isClaimTestGeneration
        ? {
            request_human_help: createHumanHandoffTool({
              request: async (reason) => {
                if (!humanHandoffArm.consume()) {
                  throw new Error(
                    "Human help is available only after Scout detects a human-only browser gate",
                  );
                }
                if (interactiveLiveViewUrl === null) {
                  throw new Error(
                    "The current browser session has no interactive human-takeover link",
                  );
                }
                return await ctx.runMutation(internal.claimTestHumanHandoffs.request, {
                  promptMessageId: args.promptMessageId,
                  reason,
                  interactiveLiveViewUrl,
                });
              },
              getStatus: async (handoffId) =>
                await ctx.runQuery(internal.claimTestHumanHandoffs.getStatus, { handoffId }),
              expire: async (handoffId) =>
                await ctx.runMutation(internal.claimTestHumanHandoffs.expire, { handoffId }),
            }),
          }
        : {};
      const activeBrowser = browser;
      if (!activeBrowser) throw new Error("Browser harness was not initialized");
      const serviceAccountTools =
        claimTestContext?.accountCreation === "required"
          ? {
              record_authenticated_service_account: createServiceAccountRecordingTool(
                async ({ accountAccess, identityRef, sessionControlRef }) => {
                  const [identity, sessionControl, currentUrl] = await Promise.all([
                    activeBrowser.actions.getElement(identityRef),
                    activeBrowser.actions.getElement(sessionControlRef),
                    activeBrowser.actions.getPage("url"),
                  ]);
                  if (!identity.success || !sessionControl.success || !currentUrl.success) {
                    throw new Error(
                      "The authenticated account evidence could not be read from the current page",
                    );
                  }
                  return await ctx.runMutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
                    promptMessageId: args.promptMessageId,
                    accountAccess,
                    observedUrl: currentUrl.output,
                    visibleIdentity: identity.output,
                    visibleSessionControl: sessionControl.output,
                  });
                },
              ),
            }
          : {};
      const accountPasswordTools =
        runtimeCredential !== null
          ? {
              fill_account_password: createAccountPasswordFillTool(
                async ({ passwordRef, passwordConfirmationRef }) => {
                  const currentUrl = await activeBrowser.actions.getPage("url");
                  if (!currentUrl.success) {
                    throw new Error("The current browser URL could not be verified");
                  }
                  assertCredentialBrowserUrl(currentUrl.output, runtimeCredential.credentialHost);
                  const passwordField = await activeBrowser.actions.getElementAttribute(
                    passwordRef,
                    "type",
                  );
                  if (!passwordField.success) {
                    throw new Error("The configured password field could not be verified");
                  }
                  requirePasswordInputType(passwordField.output);
                  if (passwordConfirmationRef) {
                    const confirmationField = await activeBrowser.actions.getElementAttribute(
                      passwordConfirmationRef,
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
                  const passwordResult = await activeBrowser.actions.fill(passwordRef, password);
                  if (!passwordResult.success) {
                    throw new Error("The configured account password could not be filled");
                  }
                  if (passwordConfirmationRef) {
                    const confirmationResult = await activeBrowser.actions.fill(
                      passwordConfirmationRef,
                      password,
                    );
                    if (!confirmationResult.success) {
                      throw new Error("The configured account password confirmation failed");
                    }
                  }
                  return { filledFields: passwordConfirmationRef ? 2 : 1 };
                },
              ),
            }
          : {};

      const tools = {
        ...browser.tools,
        ...agentMailTools,
        ...humanHandoffTools,
        ...accountPasswordTools,
        ...serviceAccountTools,
      };
      let claimTestLoopState: ClaimTestLoopState = "working";
      const passwordInstructions = managedCredentialInstructions(runtimeCredential);
      const claimTestInstructions =
        claimTestContext === null
          ? ""
          : `\n\nThis claim test uses ${claimTestContext.browserProfile.kind === "fresh" ? "a fresh browser profile with no saved website login" : `the persistent Scout browser profile ${JSON.stringify(claimTestContext.browserProfile.profileName)}`}. ${claimTestContext.accountCreation === "required" ? "Creating or recovering one free reversible account is required. Before a Supported or Qualified verdict, open an authenticated account menu and call record_authenticated_service_account with the account-access result plus refs for the visible identity and Sign out or Log out controls. The runtime resolves the account identifier from this Run; do not repeat it as a tool argument." : "Account creation is not requested for this run."} If a CAPTCHA or another strictly human-only check blocks the test, call request_human_help instead of attempting to solve, bypass, stop at, or merely report it. This human-gate rule overrides conflicting operator instructions. The tool waits while the operator takes over the same browser. After the operator continues, inspect the current page before acting. If the request expires, return Verdict: Inconclusive, not Refuted.`;
      const instructions = `${SCOUT_AGENT_INSTRUCTIONS}\n\n${scoutWebsiteIdentityInstructions(scout)}\n\n${passwordInstructions}${claimTestInstructions}`;
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
          ...(isClaimTestGeneration
            ? {
                prepareStep: ({ steps, stepNumber }) => {
                  const decision = decideClaimTestStep({
                    state: claimTestLoopState,
                    stepNumber,
                    normalCloseStep: CLAIM_TEST_CLOSE_STEP,
                    handoffCloseStep: CLAIM_TEST_HANDOFF_CLOSE_STEP,
                    previousToolResult: immediatelyPrecedingToolResult(steps),
                  });
                  claimTestLoopState = decision.nextState;
                  switch (decision.kind) {
                    case "request_human_help":
                      humanHandoffArm.arm();
                      return {
                        activeTools: ["request_human_help"] as const,
                        toolChoice: {
                          type: "tool",
                          toolName: "request_human_help",
                        } as const,
                      };
                    case "browser_snapshot":
                      return {
                        activeTools: ["browser_snapshot"] as const,
                        toolChoice: { type: "tool", toolName: "browser_snapshot" } as const,
                      };
                    case "browser_close":
                      return {
                        activeTools: ["browser_close"] as const,
                        toolChoice: { type: "tool", toolName: "browser_close" } as const,
                      };
                    case "final_inconclusive":
                      return {
                        activeTools: [] as const,
                        toolChoice: "none" as const,
                        instructions: `${instructions}\n\nThe browser is closed because a required human-only check could not be completed. Do not investigate further. Begin the final response with exactly "Verdict: Inconclusive" and explain that limitation.`,
                      };
                    case "final":
                      return {
                        activeTools: [] as const,
                        toolChoice: "none" as const,
                        instructions: `${instructions}\n\nThe bounded browser phase is over. Do not investigate further. Give the final claim verdict now, beginning with the required Verdict line.`,
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
      const persistedExpiredHandoffResult = isClaimTestGeneration
        ? await persistExpiredHumanHandoffResult(await streamResult.steps, async (message) => {
            await scoutAgent.saveMessage(ctx, {
              threadId: args.threadId,
              userId: args.userId,
              promptMessageId: args.promptMessageId,
              message,
              skipEmbeddings: true,
            });
          })
        : false;
      const parsedOutcome = claimTestContext
        ? persistedExpiredHandoffResult
          ? ({ verdict: "inconclusive" } as const)
          : parseClaimTestOutcome(await streamResult.text)
        : null;
      generationResult = {
        kind: "completed",
        usage: tokenUsage(await streamResult.totalUsage),
        ...(parsedOutcome === null ? {} : { claimTestOutcome: parsedOutcome }),
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
          ...(generationResult.claimTestOutcome === undefined
            ? {}
            : { claimTestOutcome: generationResult.claimTestOutcome }),
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
