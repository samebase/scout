import { describe, expect, it } from "vite-plus/test";
import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import {
  GENERATION_SLICE_STEPS,
  GENERATION_SLICE_WORK_BUDGET_MS,
  MAX_TURN_STEPS,
  MAX_TURN_DURATION_MS,
  generationNeedsContinuation,
  generationErrorDetails,
  generationFailureDetails,
  generationSliceTimeoutMs,
  finalStepToolsCompleted,
  modelCallContext,
  preserveTurnObjective,
  tokenUsage,
} from "./generation";
import { addScoutTokenUsage } from "./models";
import { assertCredentialBrowserUrl } from "./accountTools";
import { bundledSkills } from "./skills";
import {
  SCOUT_AGENT_INSTRUCTIONS,
  managedCredentialInstructions,
  serviceAccountLoginInstructions,
  scoutRuntimeInstructions,
  scoutWebsiteIdentityInstructions,
} from "./runtimeInstructions";

describe("Scout generation usage", () => {
  it("keeps the model cost reported by the Convex AI Gateway", () => {
    expect(
      tokenUsage({
        inputTokens: 4_000,
        inputTokenDetails: {
          noCacheTokens: 4_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 100,
        outputTokenDetails: { textTokens: 40, reasoningTokens: 60 },
        totalTokens: 4_100,
        raw: { cost: 0.000132 },
      }),
    ).toEqual({
      promptTokens: 4_000,
      completionTokens: 100,
      totalTokens: 4_100,
      reasoningTokens: 60,
      cachedInputTokens: 0,
      costUsd: 0.000132,
    });
  });

  it("adds usage and provider-reported cost across model steps", () => {
    const usage = addScoutTokenUsage(
      { promptTokens: 4_000, completionTokens: 100, totalTokens: 4_100, costUsd: 0.0001 },
      {
        promptTokens: 8_000,
        completionTokens: 200,
        totalTokens: 8_200,
        cachedInputTokens: 3_000,
        costUsd: 0.0002,
      },
    );
    expect(usage).toMatchObject({
      promptTokens: 12_000,
      completionTokens: 300,
      totalTokens: 12_300,
      cachedInputTokens: 3_000,
    });
    expect(usage.costUsd).toBeCloseTo(0.0003);
  });

  it("retains completed-step usage when a later generation step fails", () => {
    const error = new Error("final step failed");
    const result = generationFailureDetails(
      {
        kind: "failed",
        error,
        usage: { promptTokens: 12_000, completionTokens: 300, costUsd: 0.0003 },
      },
      undefined,
      undefined,
    );

    expect(result.failure).toContain("Error: final step failed");
    expect(result.terminalError).toBe(error);
    expect(result.usage).toEqual({
      promptTokens: 12_000,
      completionTokens: 300,
      costUsd: 0.0003,
    });
  });

  it("keeps the provider response and retry history in generation failures", () => {
    const providerError = new APICallError({
      message: "Provider returned error",
      url: "https://ai-gateway.convex.dev/v1/chat/completions",
      requestBodyValues: { model: "qwen/qwen3.7-flash" },
      statusCode: 503,
      responseHeaders: { "x-request-id": "request-123" },
      responseBody: '{"error":{"message":"upstream unavailable"}}',
      isRetryable: true,
    });
    const retryError = new RetryError({
      message: `Failed after 3 attempts. Last error: ${providerError}`,
      reason: "maxRetriesExceeded",
      errors: [providerError],
    });

    const details = generationErrorDetails(retryError);

    expect(details).toContain("AI_RetryError");
    expect(details).toContain("maxRetriesExceeded");
    expect(details).toContain("statusCode: 503");
    expect(details).toContain("x-request-id");
    expect(details).toContain("request-123");
    expect(details).toContain("upstream unavailable");
  });
});

describe("Scout generation slices", () => {
  it("budgets model work from action start and the overall turn deadline", () => {
    expect(generationSliceTimeoutMs(1_000, 1_000, 1_000)).toBe(GENERATION_SLICE_WORK_BUDGET_MS);
    expect(generationSliceTimeoutMs(1_000, 1_000, 61_000)).toBe(
      GENERATION_SLICE_WORK_BUDGET_MS - 60_000,
    );
    expect(generationSliceTimeoutMs(1_000, 1_000 - MAX_TURN_DURATION_MS + 30_000, 1_000)).toBe(
      30_000,
    );
    expect(generationSliceTimeoutMs(1_000, 1_000 - MAX_TURN_DURATION_MS, 1_000)).toBe(0);
  });

  it("continues only when a full slice ends on tool calls below the turn ceiling", () => {
    const finalStep = {
      toolCalls: [{ toolCallId: "call-1" }],
      content: [{ type: "tool-result", toolCallId: "call-1" }],
    };
    expect(
      generationNeedsContinuation(
        "tool-calls",
        GENERATION_SLICE_STEPS,
        0,
        GENERATION_SLICE_STEPS,
        finalStep,
      ),
    ).toBe(true);
    expect(
      generationNeedsContinuation(
        "stop",
        GENERATION_SLICE_STEPS,
        0,
        GENERATION_SLICE_STEPS,
        finalStep,
      ),
    ).toBe(true);
    expect(
      generationNeedsContinuation("stop", GENERATION_SLICE_STEPS, 0, GENERATION_SLICE_STEPS, {
        toolCalls: [],
        content: [],
      }),
    ).toBe(false);
    expect(
      generationNeedsContinuation("stop", GENERATION_SLICE_STEPS, 0, GENERATION_SLICE_STEPS, {
        ...finalStep,
        content: [],
      }),
    ).toBe(false);
    expect(
      generationNeedsContinuation(
        "tool-calls",
        GENERATION_SLICE_STEPS - 1,
        0,
        GENERATION_SLICE_STEPS,
        finalStep,
      ),
    ).toBe(false);
    expect(
      generationNeedsContinuation(
        "tool-calls",
        GENERATION_SLICE_STEPS,
        MAX_TURN_STEPS - GENERATION_SLICE_STEPS,
        GENERATION_SLICE_STEPS,
        finalStep,
      ),
    ).toBe(false);
    expect(
      generationNeedsContinuation(
        "stop",
        GENERATION_SLICE_STEPS,
        MAX_TURN_STEPS - GENERATION_SLICE_STEPS,
        GENERATION_SLICE_STEPS,
        finalStep,
      ),
    ).toBe(false);
  });

  it("does not continue from an unresolved tool call", () => {
    expect(
      finalStepToolsCompleted({
        toolCalls: [{ toolCallId: "call-1" }],
        content: [{ type: "tool-call", toolCallId: "call-1" }],
      }),
    ).toBe(false);
    expect(
      finalStepToolsCompleted({
        toolCalls: [{ toolCallId: "call-1" }],
        content: [
          { type: "tool-call", toolCallId: "call-1" },
          { type: "tool-result", toolCallId: "call-1" },
        ],
      }),
    ).toBe(true);
  });

  it("serializes the exact standardized model request without transport secrets", () => {
    const context = modelCallContext(
      {
        callId: "call-1",
        provider: "gateway",
        modelId: "model",
        instructions: "Use the browser.",
        messages: [{ role: "user", content: [{ type: "text", text: "Open Samebase" }] }],
        tools: [{ type: "function", name: "browser_execute" }],
        temperature: 0.2,
      },
      "max",
    );

    const parsed = JSON.parse(context);
    expect(parsed.instructions).toBe("Use the browser.");
    expect(parsed.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Open Samebase" }] },
    ]);
    expect(parsed.tools).toEqual([{ type: "function", name: "browser_execute" }]);
    expect(parsed.settings).toEqual({ temperature: 0.2, reasoningEffort: "max" });
  });

  it("restores the original objective only after it falls out of recent context", () => {
    const objective = "Create a Samebase app";
    const present = [{ role: "user" as const, content: objective }];
    expect(preserveTurnObjective(present, objective)).toBe(present);
    expect(preserveTurnObjective([{ role: "assistant", content: "Working" }], objective)).toEqual([
      { role: "user", content: objective },
      { role: "assistant", content: "Working" },
    ]);
  });
});

describe("Scout runtime instructions", () => {
  it("describes the Scout identity as an owned resource", () => {
    expect(
      scoutWebsiteIdentityInstructions({
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        agentMail: { inboxId: "inbox", address: "conrad@example.test" },
      }),
    ).toContain("This identity and inbox belong to the Scout");
  });

  it("treats Scout-owned OAuth as autonomous work", () => {
    const instructions = SCOUT_AGENT_INSTRUCTIONS.replaceAll(/\s+/g, " ");
    expect(instructions).toContain("Complete OAuth for the Scout's own accounts yourself");
    expect(instructions).toContain(
      "Call request_human_help when the user asks to take over the browser or the task requires an action only they can perform",
    );
  });

  it("does not confuse an initiated operation with completion", () => {
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain("Before reporting success, confirm");
  });

  it("lists all exact managed login hosts without revealing passwords", () => {
    const instructions = managedCredentialInstructions([
      { credentialHost: "github.com", identifier: "conrad@example.test" },
      { credentialHost: "dash.cloudflare.com", identifier: "conrad@example.test" },
    ]);
    expect(instructions).toContain("github.com");
    expect(instructions).toContain("dash.cloudflare.com");
    expect(instructions).toContain("fill_account_password");
    expect(managedCredentialInstructions([])).toBe("Managed passwords: none.");
  });

  it("accepts only the exact configured HTTPS login host", () => {
    expect(() =>
      assertCredentialBrowserUrl("https://github.com/login", "github.com"),
    ).not.toThrow();
    expect(() => assertCredentialBrowserUrl("https://evil.test", "github.com")).toThrow();
    expect(() => assertCredentialBrowserUrl("http://github.com", "github.com")).toThrow();
  });

  it("describes OAuth through the exact provider service account", () => {
    const instructions = serviceAccountLoginInstructions([
      {
        serviceAccountId: "github-account",
        authenticationEvidence: { kind: "none" },
        serviceName: "GitHub",
        serviceDomain: "github.com",
        identifier: "conrad-scout",
        loginMethod: {
          kind: "managed_password",
          credentialHost: "github.com",
          createdAt: 1,
        },
      },
      {
        serviceAccountId: "convex-account",
        authenticationEvidence: { kind: "succeeded", checkedAt: 1 },
        serviceName: "Convex",
        serviceDomain: "convex.dev",
        identifier: "conrad@example.test",
        loginMethod: { kind: "oauth", providerAccountId: "github-account" },
      },
    ]);

    expect(instructions.replaceAll(/\s+/g, " ")).toContain(
      'OAuth through GitHub at github.com as "conrad-scout"',
    );
  });

  it.each([false, true])("preserves quoted identity and nested guides (Play: %s)", (play) => {
    const instructions = scoutRuntimeInstructions({
      scout: {
        displayName: "Magda Scout",
        websiteIdentity: { firstName: "Magda\nScout", lastName: String.raw`A\B` },
        agentMail: { inboxId: "inbox", address: "magda@example.test" },
      },
      credentials: [],
      serviceAccounts: [],
      browserSessionOpen: play,
      activeSkills: ["games", "research"],
      purpose: play ? { kind: "play", step: "research" } : { kind: "general" },
    });

    expect(instructions).toContain(String.raw`First name: "Magda\nScout"`);
    expect(instructions).toContain(String.raw`Last name: "A\\B"`);
    expect(instructions).toContain(`<skill name="games">\n${bundledSkills.games.guidance}`);
    expect(instructions).toContain(`<skill name="research">\n${bundledSkills.research.guidance}`);
    expect(instructions.startsWith(SCOUT_AGENT_INSTRUCTIONS)).toBe(true);
    expect(instructions).toContain("\nScout identity:\n\n- First name:");
    expect(instructions.includes("This is Scout Play.")).toBe(play);
    expect(instructions.includes("This chat already has an open browser session.")).toBe(play);
  });
});
