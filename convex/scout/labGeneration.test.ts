import { describe, expect, it } from "vite-plus/test";
import {
  assertCredentialBrowserUrl,
  managedCredentialInstructions,
  scoutWebsiteIdentityInstructions,
} from "./labGeneration";

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
});
