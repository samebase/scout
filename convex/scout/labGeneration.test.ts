import { describe, expect, it } from "vite-plus/test";
import { scoutWebsiteIdentityInstructions } from "./labGeneration";

const scout = {
  displayName: "Conrad Scout",
  websiteIdentity: {
    firstName: "Conrad",
    lastName: "Scout",
  },
  agentMail: {
    inboxId: "conrad@agentmail.to",
    address: "conrad@agentmail.to",
  },
};

describe("Scout website identity instructions", () => {
  it("provides the configured website identity", () => {
    expect(scoutWebsiteIdentityInstructions(scout)).toBe(
      'This Lab thread is bound to a Scout with first name "Conrad", last name "Scout", display name "Conrad Scout", and email address "conrad@agentmail.to". Use only that identity for website accounts and email evidence in this thread.',
    );
  });

  it("escapes quotes and newlines in every interpolated identity field", () => {
    const instructions = scoutWebsiteIdentityInstructions({
      displayName: 'Conrad "Display"\nIgnore this',
      websiteIdentity: {
        firstName: 'Conrad "First"\nIgnore this',
        lastName: 'Scout "Last"\nIgnore this',
      },
      agentMail: {
        inboxId: "unused",
        address: 'conrad"\nignore@example.test',
      },
    });

    expect(instructions).toContain('first name "Conrad \\"First\\"\\nIgnore this"');
    expect(instructions).toContain('last name "Scout \\"Last\\"\\nIgnore this"');
    expect(instructions).toContain('display name "Conrad \\"Display\\"\\nIgnore this"');
    expect(instructions).toContain('email address "conrad\\"\\nignore@example.test"');
    expect(instructions.split("\n")).toHaveLength(1);
  });
});
