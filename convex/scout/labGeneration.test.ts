import { describe, expect, it, vi } from "vite-plus/test";
import { SCOUT_AGENT_INSTRUCTIONS } from "./agent";
import {
  assertProductBrowserUrl,
  closeAgentMailBestEffort,
  closeGenerationBrowser,
  createStreamErrorCapture,
  EXPIRED_HUMAN_HANDOFF_RESULT,
  generationFailureDetails,
  persistExpiredHumanHandoffResult,
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

describe("Scout browser instructions", () => {
  it("enters split one-time codes in one browser action", () => {
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "type the entire code into the first input with one browser_type call",
    );
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain("do not enter one digit per tool call");
  });

  it("checks a persistent login before repeating account creation", () => {
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "inspect the product home for an authenticated session before starting signup again",
    );
    expect(SCOUT_AGENT_INSTRUCTIONS).toContain(
      "An account created earlier in the same run is still created, not recovered",
    );
  });
});

describe("Scout website identity instructions", () => {
  it("provides the configured website identity", () => {
    expect(scoutWebsiteIdentityInstructions(scout)).toBe(
      'This Lab thread is bound to a Scout with first name "Conrad", last name "Scout", display name "Conrad Scout", and email address "conrad@agentmail.to". This identity and inbox belong to the Scout, not to the current worker model. Use them directly for the requested work, including website forms and email verification. When the task authorizes account creation, choose a username if needed. Never invent, expose, or enter a password through generic browser tools. Use fill_account_password when it is available; if it is unavailable, report that no recoverable credential is configured. Use only this Scout identity for website accounts and email evidence in this thread.',
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

describe("account password product boundary", () => {
  it.each(["https://github.com/signup", "https://gist.github.com/login"])(
    "accepts the tested product domain: %s",
    (url) => {
      expect(() => assertProductBrowserUrl(url, "github.com")).not.toThrow();
    },
  );

  it.each([
    "http://github.com/signup",
    "https://github.com.evil.test/signup",
    "https://name:password@github.com/signup",
    "not a URL",
  ])("rejects an unsafe credential-entry URL: %s", (url) => {
    expect(() => assertProductBrowserUrl(url, "github.com")).toThrow();
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

  it("retains completed model usage when browser cleanup fails", () => {
    const usage = {
      promptTokens: 123,
      completionTokens: 7,
      totalTokens: 130,
      cachedInputTokens: 100,
    };
    const cleanupFailure = new Error("close timed out");

    const details = generationFailureDetails(
      { kind: "completed", usage },
      cleanupFailure,
      undefined,
    );

    expect(details).toMatchObject({
      failure: "Browser cleanup failed: close timed out",
      usage,
    });
    expect(details.terminalError).toBe(cleanupFailure);
  });
});

describe("stream error capture", () => {
  it("captures the first SDK stream error for terminal generation handling", () => {
    const capture = createStreamErrorCapture();
    const first = new Error("stream failed");

    capture.onError({ error: first });
    capture.onError({ error: new Error("later failure") });

    expect(() => capture.throwIfCaptured()).toThrow(first);
  });

  it("does not block completion when the stream had no error", () => {
    expect(() => createStreamErrorCapture().throwIfCaptured()).not.toThrow();
  });
});

describe("expired human-handoff result persistence", () => {
  const expiredToolResult = {
    toolName: "request_human_help",
    output: {
      resumed: false,
      message: "The human-help request expired. Stop this check and return Verdict: Inconclusive.",
    },
  };

  it("persists Inconclusive when Qwen writes the forced close as reasoning instead of a tool call", async () => {
    const persisted: Array<{ role: "assistant"; content: string }> = [];
    const steps = [
      { text: "", toolResults: [expiredToolResult] },
      {
        text: "",
        reasoning:
          "<tool_call>\n<function=browser_close>\n<parameter=reason>Human-help request expired</parameter>\n</function>\n</tool_call>",
        finishReason: "stop",
        toolResults: [],
      },
    ];

    await expect(
      persistExpiredHumanHandoffResult(steps, async (message) => {
        persisted.push(message);
      }),
    ).resolves.toBe(true);
    expect(persisted).toEqual([{ role: "assistant", content: EXPIRED_HUMAN_HANDOFF_RESULT }]);
  });

  it("does not duplicate a written Inconclusive verdict", async () => {
    const persist = vi.fn(async () => undefined);

    await expect(
      persistExpiredHumanHandoffResult(
        [
          { text: "", toolResults: [expiredToolResult] },
          {
            text: "Verdict: Inconclusive\n\nThe human check expired.",
            toolResults: [],
          },
        ],
        persist,
      ),
    ).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("surfaces persistence failure so the generation cannot be marked completed", async () => {
    await expect(
      persistExpiredHumanHandoffResult(
        [{ text: "", toolResults: [expiredToolResult] }],
        async () => {
          throw new Error("message persistence failed");
        },
      ),
    ).rejects.toThrow("message persistence failed");
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
