import { tool, type ToolSet } from "ai";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import type { BrowserInteraction } from "./lib/firecrawl";

function interaction(overrides: Partial<BrowserInteraction> = {}): BrowserInteraction {
  return {
    success: true,
    stdout: '- textbox "Email" [ref=e1]',
    result: "",
    stderr: "",
    exitCode: 0,
    killed: false,
    error: null,
    output: "",
    replayAvailable: false,
    ...overrides,
  };
}

function dependencies() {
  return {
    createSession: vi.fn(async () => ({ sessionId: "session-1" })),
    executeCode: vi.fn(async () => interaction()),
    closeSession: vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
      replayAvailable: true,
    })),
    sleep: vi.fn(async () => undefined),
  };
}

describe("Lab browser harness", () => {
  test("opens fresh by default and returns a sanitized interactive snapshot", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com/login")).resolves.toEqual({
      success: true,
      output: '- textbox "Email" [ref=e1]',
      error: null,
      exitCode: 0,
      killed: false,
      replayAvailable: false,
    });
    expect(deps.createSession).toHaveBeenCalledWith(undefined);
    expect(deps.executeCode).toHaveBeenCalledWith(
      "session-1",
      "'agent-browser' 'open' 'https://example.com/login' && 'agent-browser' 'snapshot' '-i'",
      60,
      "bash",
      "mutate",
    );
  });

  test("loads a persistent profile only from trusted harness configuration", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({ profileName: "scout-conrad" }, deps);

    await browser.open("https://example.com");

    expect(deps.createSession).toHaveBeenCalledWith("scout-conrad");
  });

  test("constructs shell-quoted commands from structured actions", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.fill("@e1", "hello & env; $(whoami) 'quoted'");

    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      `'agent-browser' 'fill' '@e1' 'hello & env; $(whoami) '"'"'quoted'"'"''`,
      60,
      "bash",
      "mutate",
    );
  });

  test("waits for fixed durations locally without executing provider code", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockClear();

    await expect(browser.actions.waitForMilliseconds(2_500)).resolves.toMatchObject({
      success: true,
      output: "Waited 2500ms locally",
    });

    expect(deps.sleep).toHaveBeenCalledWith(2_500);
    expect(deps.executeCode).not.toHaveBeenCalled();
  });

  test("rejects invalid refs and non-HTTPS navigation before contacting Firecrawl", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.click("button.login")).rejects.toThrow("must look like @e1");
    await expect(browser.actions.navigate("http://example.com")).rejects.toThrow("must use HTTPS");
    expect(deps.executeCode).toHaveBeenCalledTimes(1);
  });

  test("requires an open session and prevents commands after close", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.actions.snapshot()).rejects.toThrow("Open a browser session");
    await browser.open("https://example.com");
    await browser.close();
    await expect(browser.actions.snapshot()).rejects.toThrow("Open a browser session");
  });

  test("serializes concurrent commands against one browser session", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    deps.executeCode
      .mockImplementationOnce(async () => {
        await first;
        return interaction({ stdout: "first" });
      })
      .mockImplementationOnce(async () => interaction({ stdout: "second" }));

    const firstRun = browser.actions.getPage("url");
    const secondRun = browser.actions.snapshot();
    await vi.waitFor(() => expect(deps.executeCode).toHaveBeenCalledTimes(2));
    releaseFirst?.();

    await expect(firstRun).resolves.toMatchObject({ output: "first" });
    await expect(secondRun).resolves.toMatchObject({ output: "second" });
    expect(deps.executeCode).toHaveBeenCalledTimes(3);
  });

  test("closes once and preserves Firecrawl accounting", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const firstClose = await browser.close();
    const secondClose = await browser.close();

    expect(firstClose).toEqual({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
      replayAvailable: true,
    });
    expect(secondClose).toEqual(firstClose);
    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });

  test("a close before open does not prevent later session cleanup", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.close()).resolves.toBeUndefined();
    await browser.open("https://example.com");
    await expect(browser.close()).resolves.toMatchObject({ success: true });

    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });

  test("serializes a same-tick close behind the open it follows", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    const opening = browser.open("https://example.com");
    const closing = browser.close();
    await Promise.all([opening, closing]);

    expect(deps.createSession).toHaveBeenCalledTimes(1);
    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });

  test("shares one in-flight DELETE between concurrent close callers", async () => {
    const deps = dependencies();
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    deps.closeSession.mockImplementationOnce(async () => {
      await closeGate;
      return {
        success: true,
        sessionDurationMs: 1_500,
        creditsBilled: 2,
        replayAvailable: false,
      };
    });
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const firstClose = browser.close();
    const secondClose = browser.close();
    await vi.waitFor(() => expect(deps.closeSession).toHaveBeenCalledTimes(1));
    releaseClose?.();

    await expect(Promise.all([firstClose, secondClose])).resolves.toHaveLength(2);
    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });

  test("allows one later cleanup retry after a failed in-flight DELETE", async () => {
    const deps = dependencies();
    deps.closeSession.mockRejectedValueOnce(new Error("connection reset after DELETE"));
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const firstClose = browser.close();
    const concurrentClose = browser.close();
    await Promise.all([
      expect(firstClose).rejects.toThrow("connection reset after DELETE"),
      expect(concurrentClose).rejects.toThrow("connection reset after DELETE"),
    ]);
    expect(deps.closeSession).toHaveBeenCalledTimes(1);

    await expect(browser.close()).resolves.toMatchObject({ success: true });
    expect(deps.closeSession).toHaveBeenCalledTimes(2);
  });

  test("caches the second close failure as terminal", async () => {
    const deps = dependencies();
    deps.closeSession
      .mockRejectedValueOnce(new Error("first ambiguous DELETE failure"))
      .mockRejectedValueOnce(new Error("second ambiguous DELETE failure"));
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.close()).rejects.toThrow("first ambiguous DELETE failure");
    await expect(browser.close()).rejects.toThrow("second ambiguous DELETE failure");
    await expect(browser.close()).rejects.toThrow("second ambiguous DELETE failure");
    await expect(browser.close()).rejects.toThrow("second ambiguous DELETE failure");

    expect(deps.closeSession).toHaveBeenCalledTimes(2);
  });

  test("redacts provider URLs before returning tool output", async () => {
    const deps = dependencies();
    deps.executeCode.mockResolvedValueOnce(
      interaction({ stdout: "watch https://sessions.firecrawl.dev/live?token=secret" }),
    );
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).resolves.toMatchObject({
      output: "watch [Firecrawl URL redacted]",
    });
  });
});

describe("AgentMail Lab catalog", () => {
  test("binds the read tools to one configured inbox", async () => {
    const execute = vi.fn(async (input: unknown) => input);
    const toModelOutput = vi.fn(() => ({ type: "text" as const, value: "converted" }));
    const readTool = tool({ inputSchema: z.object({}), execute, toModelOutput });
    const allTools: ToolSet = {
      list_inboxes: readTool,
      list_messages: readTool,
      search_messages: readTool,
      get_thread: readTool,
      send_message: readTool,
      delete_inbox: readTool,
    };
    const selected = selectAgentMailTools(allTools, "conrad@agentmail.to");
    const options = { toolCallId: "tool-1", messages: [], context: undefined };

    expect(Object.keys(selected)).toEqual(["list_messages", "search_messages", "get_thread"]);
    await selected.list_messages.execute({ limit: 5 }, options);
    await selected.search_messages.execute({ q: "verification" }, options);
    await selected.get_thread.execute({ threadId: "thread-1" }, options);
    if (!selected.list_messages.toModelOutput) {
      throw new Error("Expected the scoped tool to retain AgentMail's model-output adapter");
    }
    await expect(
      selected.list_messages.toModelOutput({
        toolCallId: "tool-1",
        input: { limit: 5 },
        output: { content: [{ type: "text", text: "message" }] },
      }),
    ).resolves.toEqual({ type: "text", value: "converted" });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      { limit: 5, inboxId: "conrad@agentmail.to" },
      options,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      { q: "verification", inboxId: "conrad@agentmail.to" },
      options,
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      { threadId: "thread-1", inboxId: "conrad@agentmail.to" },
      options,
    );
    expect(toModelOutput).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      input: { limit: 5 },
      output: { content: [{ type: "text", text: "message" }] },
    });
  });

  test("fails closed when the hosted catalog loses a required tool", () => {
    const readTool = tool({
      inputSchema: z.object({}),
      execute: async () => null,
      toModelOutput: () => ({ type: "text", value: "converted" }),
    });

    expect(() => selectAgentMailTools({ list_messages: readTool }, "conrad@agentmail.to")).toThrow(
      "AgentMail MCP tool search_messages is unavailable",
    );
  });
});
