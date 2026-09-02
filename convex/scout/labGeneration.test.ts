import { describe, expect, it } from "vite-plus/test";
import {
  assertCredentialBrowserUrl,
  managedCredentialInstructions,
  serviceAccountLoginInstructions,
  scoutWebsiteIdentityInstructions,
} from "./labGeneration";
import { SCOUT_AGENT_INSTRUCTIONS } from "./agent";

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
