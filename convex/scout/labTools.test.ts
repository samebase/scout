import { tool, type ToolSet } from "ai";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { browserTraceMarkers } from "./browserTelemetry";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import type { BrowserInteraction, BrowserOperation } from "./lib/firecrawl";

const atomicSnapshotSuffix =
  " && { 'agent-browser' 'snapshot' '-i' '-c' || { 'printf' '%s\\n' '__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__' >&2; exit 86; }; }";

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
    createSession: vi.fn(async () => ({
      sessionId: "session-1",
      liveViewUrl: null as string | null,
      interactiveLiveViewUrl: null as string | null,
    })),
    executeCode: vi.fn(
      async (
        _sessionId: string,
        _code: string,
        _timeoutSeconds: number,
        _language?: "node" | "bash",
        _operation?: BrowserOperation,
      ) => interaction(),
    ),
    closeSession: vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
      replayAvailable: true,
    })),
    sleep: vi.fn(async () => undefined),
    traceToken: vi.fn(() => "fixed"),
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

  test("publishes a live view outside model-visible tool output and clears it after close", async () => {
    const deps = dependencies();
    const liveViewUrl = "https://liveview.firecrawl.dev/private?signature=read-only";
    const interactiveLiveViewUrl =
      "https://liveview.firecrawl.dev/private?signature=interactive-control";
    deps.createSession.mockResolvedValueOnce({
      sessionId: "session-1",
      liveViewUrl,
      interactiveLiveViewUrl,
    });
    const onSessionAvailable = vi.fn(async () => undefined);
    const onLiveViewAvailable = vi.fn(async () => undefined);
    const onInteractiveLiveViewAvailable = vi.fn(async () => undefined);
    const onLiveViewClosed = vi.fn(async () => undefined);
    const browser = createLabBrowserHarness(
      {
        onSessionAvailable,
        onLiveViewAvailable,
        onInteractiveLiveViewAvailable,
        onLiveViewClosed,
      },
      deps,
    );

    const output = await browser.tools.browser_open.execute(
      { url: "https://example.com" },
      { toolCallId: "tool-1", messages: [], context: undefined },
    );

    expect(onSessionAvailable).toHaveBeenCalledWith("session-1");
    expect(onLiveViewAvailable).toHaveBeenCalledWith(liveViewUrl);
    expect(onInteractiveLiveViewAvailable).toHaveBeenCalledWith(interactiveLiveViewUrl);
    expect(JSON.stringify(output)).not.toContain(liveViewUrl);
    expect(JSON.stringify(output)).not.toContain(interactiveLiveViewUrl);
    await expect(browser.close()).resolves.toMatchObject({ success: true });
    expect(onLiveViewClosed).toHaveBeenCalledOnce();
  });

  test("captures one strict operation envelope without storing URL secrets", async () => {
    const deps = dependencies();
    const markers = browserTraceMarkers("fixed");
    const beforeTabs = JSON.stringify({ success: true, data: { tabs: [] } });
    const afterTabs = JSON.stringify({
      success: true,
      data: {
        tabs: [
          {
            tabId: "t1",
            title: "Account",
            url: "https://example.com/account?code=secret",
            active: true,
          },
        ],
      },
    });
    deps.executeCode.mockResolvedValueOnce(
      interaction({
        stdout: [
          markers.begin,
          "1000",
          beforeTabs,
          "1010",
          "1020",
          afterTabs,
          markers.end,
          '- heading "Account"',
        ].join("\n"),
        stderr: `${markers.dispatch}\n`,
      }),
    );
    const onOperationPrepared = vi.fn(async () => true);
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createLabBrowserHarness(
      {
        onSessionAvailable: async () => ({ captureOperations: true }),
        onOperationPrepared,
        onOperationSettled,
      },
      deps,
    );

    const result = await browser.tools.browser_open.execute(
      { url: "https://example.com/account?code=secret#finish" },
      { toolCallId: "tool-1", messages: [], context: undefined },
    );

    expect(result).toMatchObject({ success: true, output: '- heading "Account"' });
    expect(onOperationPrepared).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      action: { kind: "open", url: "https://example.com/account" },
    });
    expect(onOperationSettled).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      outcome: {
        kind: "applied",
        telemetry: expect.objectContaining({
          before: { capturedAtMs: 1000, tabs: [] },
          dispatchedAtMs: 1010,
          returnedAtMs: 1020,
          after: {
            capturedAtMs: 1020,
            tabs: [
              expect.objectContaining({
                tabId: "t1",
                url: "https://example.com/account",
              }),
            ],
          },
        }),
      },
    });
    expect(deps.executeCode.mock.calls[0]?.[1]).toContain(
      "'agent-browser' 'set' 'viewport' '1280' '800'",
    );
    expect(deps.executeCode.mock.calls[0]?.[1]).toContain("'agent-browser' '--json' 'tab'");
    expect(deps.executeCode.mock.calls[0]?.[1]).toContain(
      "'agent-browser' 'open' 'https://example.com/account?code=secret#finish' >/dev/null",
    );
  });

  test("settles a rejected execute request as indeterminate and stops later mutations", async () => {
    const deps = dependencies();
    deps.executeCode.mockRejectedValueOnce(new Error("socket reset after request"));
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createLabBrowserHarness(
      {
        onSessionAvailable: async () => ({ captureOperations: true }),
        onOperationPrepared: async () => true,
        onOperationSettled,
      },
      deps,
    );

    await expect(
      browser.tools.browser_open.execute(
        { url: "https://example.com" },
        { toolCallId: "tool-1", messages: [], context: undefined },
      ),
    ).rejects.toThrow("outcome is unknown");
    expect(onOperationSettled).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      outcome: {
        kind: "indeterminate_after_dispatch",
        failure: "Browser provider transport failed; dispatch status is unknown",
      },
    });

    await expect(browser.actions.navigate("https://example.com/next", "tool-2")).rejects.toThrow(
      "outcome is unknown",
    );
    expect(deps.executeCode).toHaveBeenCalledOnce();
  });

  test("constructs shell-quoted commands from structured actions", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.fill("@e1", "hello & env; $(whoami) 'quoted'");

    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      `'agent-browser' 'fill' '@e1' 'hello & env; $(whoami) '"'"'quoted'"'"''${atomicSnapshotSuffix}`,
      60,
      "bash",
      "mutate",
    );
  });

  test("shell-quotes count selectors and dispatches them as a read", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.getCount(`div[data-note="$(whoami); 'quoted'"]`);

    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      `'agent-browser' 'get' 'count' 'div[data-note="$(whoami); '"'"'quoted'"'"'"]'`,
      60,
      "bash",
      "read",
    );
  });

  test("reads a trusted element type attribute without exposing generic values", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockResolvedValueOnce(interaction({ stdout: "password" }));

    await expect(browser.actions.getElementAttribute("@e7", "type")).resolves.toMatchObject({
      output: "password",
    });
    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      "'agent-browser' 'get' 'attr' '@e7' 'type'",
      60,
      "bash",
      "read",
    );
  });

  test("redacts a registered password from later model-visible snapshots", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    browser.actions.registerSensitiveValue("configured-secret-123");
    deps.executeCode.mockResolvedValueOnce(
      interaction({ stdout: '- textbox "Password" value="configured-secret-123" [ref=e7]' }),
    );

    const snapshot = await browser.actions.snapshot();

    expect(JSON.stringify(snapshot)).not.toContain("configured-secret-123");
    expect(snapshot.output).toContain("[secret redacted]");
  });

  test("redacts a URL-shaped password before sanitizing ordinary URLs", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    const password = "https://secret.example/password-path?piece=tail";
    browser.actions.registerSensitiveValue(password);
    deps.executeCode.mockResolvedValueOnce(
      interaction({
        stdout: `- textbox "Password" value="${password}" [ref=e7]`,
        error: `Provider echoed ${password}`,
      }),
    );

    const snapshot = await browser.actions.snapshot();

    expect(JSON.stringify(snapshot)).not.toContain("password-path");
    expect(snapshot.output).toContain("[secret redacted]");
  });

  test("dispatches browser_get count through the narrow read action", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockResolvedValueOnce(interaction({ stdout: "3" }));

    const result = await browser.tools.browser_get.execute(
      { kind: "count", selector: ".summary-card > svg" },
      { toolCallId: "tool-1", messages: [], context: undefined },
    );

    expect(result).toMatchObject({ output: "3" });
    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      "'agent-browser' 'get' 'count' '.summary-card > svg'",
      60,
      "bash",
      "read",
    );
  });

  test("bounds count selectors before contacting the provider", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.getCount("x".repeat(1_001))).rejects.toThrow(
      "CSS selector must be 1000 characters or fewer",
    );
    expect(deps.executeCode).toHaveBeenCalledTimes(1);
  });

  test.each([
    "navigate",
    "click",
    "fill",
    "type",
    "press",
    "select",
    "check",
    "back",
    "reload",
  ] as const)("returns a compact post-action snapshot after atomic %s", async (kind) => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockClear();
    const compactSnapshot = '- button "Continue" [ref=e2]';
    deps.executeCode.mockResolvedValueOnce(interaction({ stdout: compactSnapshot }));

    let command: string;
    let output: string;
    switch (kind) {
      case "navigate":
        output = (await browser.actions.navigate("https://example.com/next")).output;
        command = "'agent-browser' 'open' 'https://example.com/next'";
        break;
      case "click":
        output = (await browser.actions.click("@e1")).output;
        command = "'agent-browser' 'click' '@e1'";
        break;
      case "fill":
        output = (await browser.actions.fill("@e1", "Ada")).output;
        command = "'agent-browser' 'fill' '@e1' 'Ada'";
        break;
      case "type":
        output = (await browser.actions.type("@e1", "Ada")).output;
        command = "'agent-browser' 'type' '@e1' 'Ada'";
        break;
      case "press":
        output = (await browser.actions.press("Enter")).output;
        command = "'agent-browser' 'press' 'Enter'";
        break;
      case "select":
        output = (await browser.actions.select("@e1", "one")).output;
        command = "'agent-browser' 'select' '@e1' 'one'";
        break;
      case "check":
        output = (await browser.actions.check("@e1")).output;
        command = "'agent-browser' 'check' '@e1'";
        break;
      case "back":
        output = (await browser.actions.back()).output;
        command = "'agent-browser' 'back'";
        break;
      case "reload":
        output = (await browser.actions.reload()).output;
        command = "'agent-browser' 'reload'";
        break;
    }

    expect(output).toBe(compactSnapshot);
    expect(deps.executeCode).toHaveBeenCalledOnce();
    expect(deps.executeCode).toHaveBeenCalledWith(
      "session-1",
      `${command}${atomicSnapshotSuffix}`,
      60,
      "bash",
      "mutate",
    );
  });

  test("marks a successful mutation with a failed post-action snapshot as non-retryable", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockResolvedValueOnce(
      interaction({
        success: false,
        stdout: "",
        stderr: "snapshot error\n__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__\n",
        exitCode: 86,
        error: "command failed",
      }),
    );

    const result = await browser.actions.click("@e1");

    expect(result).toMatchObject({
      success: false,
      error: "PostActionSnapshotFailed",
      stderr: "snapshot error",
      mutationApplied: true,
      doNotRetry: true,
    });
    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "session-1",
      "'agent-browser' 'click' '@e1' && { 'agent-browser' 'snapshot' '-i' '-c' || { 'printf' '%s\\n' '__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__' >&2; exit 86; }; }",
      60,
      "bash",
      "mutate",
    );
  });

  test("does not claim a failed atomic mutation was applied", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.executeCode.mockResolvedValueOnce(
      interaction({
        success: false,
        stdout: "",
        stderr: "mutation failed\n__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__",
        exitCode: 1,
        error: "command failed",
      }),
    );

    const result = await browser.actions.click("@e1");

    expect(result).toMatchObject({ success: false, error: "command failed" });
    expect(result).not.toHaveProperty("mutationApplied");
    expect(result).not.toHaveProperty("doNotRetry");
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
    await expect(browser.actions.navigate("https://name:secret@example.com")).rejects.toThrow(
      "must not contain credentials",
    );
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

  test("removes credentials and query secrets from returned non-provider URLs", async () => {
    const deps = dependencies();
    deps.executeCode.mockResolvedValueOnce(
      interaction({ stdout: "opened https://name:secret@example.com/account?token=secret#finish" }),
    );
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).resolves.toMatchObject({
      output: "opened https://example.com/account",
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
