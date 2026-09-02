import { describe, expect, it } from "vite-plus/test";
import {
  addScoutTokenUsage,
  assertCredentialBrowserUrl,
  generationFailureDetails,
  managedCredentialInstructions,
  serviceAccountLoginInstructions,
  scoutWebsiteIdentityInstructions,
  tokenUsage,
} from "./labGeneration";
import { SCOUT_AGENT_INSTRUCTIONS } from "./agent";

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
    expect(
      generationFailureDetails(
        {
          kind: "failed",
          error,
          usage: { promptTokens: 12_000, completionTokens: 300, costUsd: 0.0003 },
        },
        undefined,
        undefined,
      ),
    ).toEqual({
      failure: "final step failed",
      terminalError: error,
      usage: { promptTokens: 12_000, completionTokens: 300, costUsd: 0.0003 },
    });
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
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "OAuth account selection and consent for the Scout's own registered accounts are ordinary browser work",
    );
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain("never request human help merely for authorization");
  });

  it("does not confuse an initiated operation with completion", () => {
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "A submitted, scheduled, pending, processing, or deleting state proves initiation, not completion",
    );
  });

  it("selects popup pages explicitly and records accounts before optional onboarding", () => {
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain("page.context().pages()");
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "record the account before continuing with optional onboarding",
    );
  });

  it("lists all exact managed login hosts without revealing passwords", () => {
    const instructions = managedCredentialInstructions([
      { credentialHost: "github.com", identifier: "conrad@example.test" },
      { credentialHost: "dash.cloudflare.com", identifier: "conrad@example.test" },
    ]);
    expect(instructions).toContain("github.com");
    expect(instructions).toContain("dash.cloudflare.com");
    expect(instructions).toContain("expose no password values");
    expect(managedCredentialInstructions([])).toContain("no managed passwords");
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
        serviceName: "Convex",
        serviceDomain: "convex.dev",
        identifier: "conrad@example.test",
        loginMethod: { kind: "oauth", providerAccountId: "github-account" },
      },
    ]);

    expect(instructions).toContain('OAuth through GitHub at github.com as "conrad-scout"');
  });
});
