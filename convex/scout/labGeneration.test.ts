import { describe, expect, it, vi } from "vite-plus/test";
import {
  closeAgentMailBestEffort,
  closeGenerationBrowser,
  scoutWebsiteIdentityInstructions,
} from "./labGeneration";

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

describe("generation browser cleanup", () => {
  it("delegates cleanup to one browser close operation", async () => {
    const close = vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_000,
      creditsBilled: 2,
      replayAvailable: false,
    }));

    await expect(closeGenerationBrowser({ close })).resolves.toMatchObject({ success: true });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("AgentMail cleanup", () => {
  it("does not surface a close failure", async () => {
    const close = vi.fn(async () => {
      throw new Error("MCP shutdown failed");
    });

    await expect(closeAgentMailBestEffort({ close }, 10)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops waiting at the bounded deadline", async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => await new Promise<void>(() => undefined));

    const cleanup = closeAgentMailBestEffort({ close }, 25);
    await vi.advanceTimersByTimeAsync(24);
    let settled = false;
    void cleanup.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(cleanup).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
