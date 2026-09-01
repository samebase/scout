import { tool, type ToolSet } from "ai";
import { safeValidateTypes } from "@ai-sdk/provider-utils";
import type { BrowserCreateResponse, BrowserExecuteResponse } from "firecrawl";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { browserTraceMarkers } from "./browserTelemetry";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";

const atomicSnapshotSuffix =
  " && { 'agent-browser' 'snapshot' '-i' '-c' || { 'printf' '%s\\n' '__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__' >&2; exit 86; }; }";

function interaction(overrides: Partial<BrowserExecuteResponse> = {}): BrowserExecuteResponse {
  return {
    success: true,
    stdout: '- textbox "Email" [ref=e1]',
    result: "",
    stderr: "",
    exitCode: 0,
    killed: false,
    output: "",
    ...overrides,
  };
}

function dependencies() {
  return {
    browser: vi.fn(
      async (): Promise<BrowserCreateResponse> => ({ success: true, id: "session-1" }),
    ),
    browserExecute: vi.fn(
      async (
        _sessionId: string,
        _options: { code: string; language?: "python" | "node" | "bash"; timeout?: number },
      ) => interaction(),
    ),
    deleteBrowser: vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
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
    });
    expect(deps.browser).toHaveBeenCalledWith({
      activityTtl: 3_600,
      streamWebView: true,
      ttl: 3_600,
    });
    expect(deps.browserExecute).toHaveBeenCalledWith("session-1", {
      code: "'agent-browser' 'open' 'https://example.com/login' && 'agent-browser' 'snapshot' '-i'",
      language: "bash",
      timeout: 60,
    });
  });

  test("loads a persistent profile only from trusted harness configuration", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({ profileName: "scout-conrad" }, deps);

    await browser.open("https://example.com");

    expect(deps.browser).toHaveBeenCalledWith({
      activityTtl: 3_600,
      profile: { name: "scout-conrad", saveChanges: true },
      streamWebView: true,
      ttl: 3_600,
    });
  });

  test("keeps profile and live views available after a sensitive value is registered", async () => {
    const deps = dependencies();
    const password = "HackathonPassword!42x";
    const onLiveViewAvailable = vi.fn(async () => undefined);
    const onInteractiveLiveViewAvailable = vi.fn(async () => undefined);
    deps.browser.mockResolvedValueOnce({
      success: true,
      id: "session-1",
      liveViewUrl: "https://liveview.firecrawl.dev/private?signature=read-only",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });
    const browser = createLabBrowserHarness(
      {
        profileName: "scout-conrad",
        onLiveViewAvailable,
        onInteractiveLiveViewAvailable,
      },
      deps,
    );

    await browser.open("https://accounts.example.com/signup");
    browser.actions.registerSensitiveValue(password);
    await browser.actions.fill("@e2", password);

    deps.browserExecute.mockResolvedValueOnce(
      interaction({ stdout: `raw ${password}; encoded ${encodeURIComponent(password)}` }),
    );
    await expect(browser.actions.snapshot()).resolves.toMatchObject({
      output: "raw [secret redacted]; encoded [secret redacted]",
    });
    expect(deps.browser).toHaveBeenCalledWith({
      activityTtl: 3_600,
      profile: { name: "scout-conrad", saveChanges: true },
      streamWebView: true,
      ttl: 3_600,
    });
    expect(onLiveViewAvailable).toHaveBeenCalledOnce();
    expect(onInteractiveLiveViewAvailable).toHaveBeenCalledOnce();
    expect(browser.tools).not.toHaveProperty("browser_submit_managed_password");
  });

  test("uses a constant provider error after a sensitive value without disabling later reads", async () => {
    const deps = dependencies();
    const password = "NeverEchoThis!42";
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://accounts.example.com/login");
    browser.actions.registerSensitiveValue(password);
    deps.browserExecute.mockRejectedValueOnce(new Error(`provider echoed ${password}`));

    await expect(browser.actions.snapshot()).rejects.toThrow(
      "Browser provider request failed after managed credential use",
    );
    deps.browserExecute.mockResolvedValueOnce(interaction({ stdout: '- heading "Recovered"' }));
    await expect(browser.actions.snapshot()).resolves.toMatchObject({
      output: '- heading "Recovered"',
    });
  });

  test("keeps managed credential material out of browser cleanup failures", async () => {
    const deps = dependencies();
    const password = "NeverEchoThisDuringClose!42";
    deps.deleteBrowser.mockRejectedValueOnce(new Error(`provider echoed ${password}`));
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://accounts.example.com/login");
    browser.actions.registerSensitiveValue(password);
    const closeTool = browser.tools.browser_close;
    if (!closeTool?.execute) throw new Error("Expected browser close tool");

    let failure = "";
    try {
      await closeTool.execute({}, { toolCallId: "tool-close", messages: [], context: undefined });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect(failure).toBe("Managed browser cleanup failed");
    expect(failure).not.toContain(password);
    expect(failure).not.toContain(encodeURIComponent(password));
    await expect(browser.close()).resolves.toMatchObject({ success: true });
    expect(deps.deleteBrowser).toHaveBeenCalledTimes(2);
  });

  test("publishes a live view outside model-visible tool output and clears it after close", async () => {
    const deps = dependencies();
    const liveViewUrl = "https://liveview.firecrawl.dev/private?signature=read-only";
    const interactiveLiveViewUrl =
      "https://liveview.firecrawl.dev/private?signature=interactive-control";
    deps.browser.mockResolvedValueOnce({
      success: true,
      id: "session-1",
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
    deps.browserExecute.mockResolvedValueOnce(
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
    expect(deps.browserExecute.mock.calls[0]?.[1].code).toContain(
      "'agent-browser' 'set' 'viewport' '1280' '800'",
    );
    expect(deps.browserExecute.mock.calls[0]?.[1].code).toContain("'agent-browser' '--json' 'tab'");
    expect(deps.browserExecute.mock.calls[0]?.[1].code).toContain(
      "'agent-browser' 'open' 'https://example.com/account?code=secret#finish' >/dev/null",
    );
  });

  test("settles a rejected execute request as indeterminate and stops later mutations", async () => {
    const deps = dependencies();
    deps.browserExecute.mockRejectedValueOnce(new Error("socket reset after request"));
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
        failure:
          "Browser provider transport failed: socket reset after request; dispatch status is unknown",
      },
    });

    await expect(browser.actions.navigate("https://example.com/next", "tool-2")).rejects.toThrow(
      "outcome is unknown",
    );
    expect(deps.browserExecute).toHaveBeenCalledOnce();
  });

  test("does not record a nonzero remote command as an applied mutation", async () => {
    const deps = dependencies();
    const markers = browserTraceMarkers("fixed");
    const beforeTabs = JSON.stringify({ success: true, data: { tabs: [] } });
    const afterTabs = JSON.stringify({
      success: true,
      data: {
        tabs: [
          {
            tabId: "t1",
            title: "Example",
            url: "https://example.com",
            active: true,
          },
        ],
      },
    });
    deps.browserExecute.mockResolvedValueOnce(
      interaction({
        stdout: [markers.begin, "1000", beforeTabs, "1010", "1020", afterTabs, markers.end].join(
          "\n",
        ),
        stderr: markers.dispatch,
        exitCode: 1,
        error: "Execution failed",
      }),
    );
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createLabBrowserHarness(
      {
        onSessionAvailable: async () => ({ captureOperations: true }),
        onOperationPrepared: async () => true,
        onOperationSettled,
      },
      deps,
    );

    await expect(browser.open("https://example.com")).rejects.toThrow(
      "outcome could not be observed",
    );
    expect(onOperationSettled).toHaveBeenCalledWith({
      toolCallId: "local-1",
      outcome: {
        kind: "indeterminate_after_dispatch",
        failure: "Browser provider command failed with exit code 1: Execution failed",
      },
    });
  });

  test("constructs shell-quoted commands from structured actions", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.fill("@e1", "hello & env; $(whoami) 'quoted'");

    expect(deps.browserExecute).toHaveBeenLastCalledWith("session-1", {
      code: `'agent-browser' 'fill' '@e1' 'hello & env; $(whoami) '"'"'quoted'"'"''${atomicSnapshotSuffix}`,
      language: "bash",
      timeout: 60,
    });
  });

  test("shell-quotes count selectors", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.getCount(`div[data-note="$(whoami); 'quoted'"]`);

    expect(deps.browserExecute).toHaveBeenLastCalledWith("session-1", {
      code: `'agent-browser' 'get' 'count' 'div[data-note="$(whoami); '"'"'quoted'"'"'"]'`,
      language: "bash",
      timeout: 60,
    });
  });

  test("reads a trusted element type attribute without exposing generic values", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockResolvedValueOnce(interaction({ stdout: "password" }));

    await expect(browser.actions.getElementAttribute("@e7", "type")).resolves.toMatchObject({
      output: "password",
    });
    expect(deps.browserExecute).toHaveBeenLastCalledWith("session-1", {
      code: "'agent-browser' 'get' 'attr' '@e7' 'type'",
      language: "bash",
      timeout: 60,
    });
  });

  test("dispatches browser_get count through the narrow read action", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockResolvedValueOnce(interaction({ stdout: "3" }));

    const result = await browser.tools.browser_get.execute(
      { kind: "count", selector: ".summary-card > svg" },
      { toolCallId: "tool-1", messages: [], context: undefined },
    );

    expect(result).toMatchObject({ output: "3" });
    expect(deps.browserExecute).toHaveBeenLastCalledWith("session-1", {
      code: "'agent-browser' 'get' 'count' '.summary-card > svg'",
      language: "bash",
      timeout: 60,
    });
  });

  test("bounds count selectors before contacting Firecrawl", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.getCount("x".repeat(1_001))).rejects.toThrow(
      "CSS selector must be 1000 characters or fewer",
    );
    expect(deps.browserExecute).toHaveBeenCalledTimes(1);
  });

  test("redacts a registered password from later model-visible snapshots", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    browser.actions.registerSensitiveValue("configured-secret-123");
    deps.browserExecute.mockResolvedValueOnce(
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
    deps.browserExecute.mockResolvedValueOnce(
      interaction({
        stdout: `- textbox "Password" value="${password}" [ref=e7]`,
        error: `Provider echoed ${password}`,
      }),
    );

    const snapshot = await browser.actions.snapshot();

    expect(JSON.stringify(snapshot)).not.toContain("password-path");
    expect(snapshot.output).toContain("[secret redacted]");
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
    deps.browserExecute.mockClear();
    const compactSnapshot = '- button "Continue" [ref=e2]';
    deps.browserExecute.mockResolvedValueOnce(interaction({ stdout: compactSnapshot }));

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
    expect(deps.browserExecute).toHaveBeenCalledOnce();
    expect(deps.browserExecute).toHaveBeenCalledWith("session-1", {
      code: `${command}${atomicSnapshotSuffix}`,
      language: "bash",
      timeout: 60,
    });
  });

  test("marks a successful mutation with a failed post-action snapshot as non-retryable", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockResolvedValueOnce(
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
    expect(deps.browserExecute).toHaveBeenLastCalledWith("session-1", {
      code: "'agent-browser' 'click' '@e1' && { 'agent-browser' 'snapshot' '-i' '-c' || { 'printf' '%s\\n' '__SCOUT_SNAPSHOT_FAILED_AFTER_MUTATION__' >&2; exit 86; }; }",
      language: "bash",
      timeout: 60,
    });
  });

  test("does not claim a failed atomic mutation was applied", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockResolvedValueOnce(
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

  test("treats a nonzero remote command as failed even when the API request succeeded", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockResolvedValueOnce(
      interaction({ success: true, exitCode: 1, error: "Execution failed" }),
    );

    await expect(browser.actions.snapshot()).resolves.toMatchObject({
      success: false,
      exitCode: 1,
      error: "Execution failed",
    });
  });

  test("waits for fixed durations locally without executing provider code", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");
    deps.browserExecute.mockClear();

    await expect(browser.actions.waitForMilliseconds(2_500)).resolves.toMatchObject({
      success: true,
      output: "Waited 2500ms locally",
    });

    expect(deps.sleep).toHaveBeenCalledWith(2_500);
    expect(deps.browserExecute).not.toHaveBeenCalled();
  });

  test("accepts a decimal string for a fixed wait and normalizes it before execution", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    const input = { kind: "milliseconds", duration: "2000" } as const;
    const validation = await safeValidateTypes({
      value: input,
      schema: browser.tools.browser_wait.inputSchema,
    });
    expect(validation).toMatchObject({ success: true, value: input });
    if (!validation.success) throw validation.error;

    await expect(
      browser.tools.browser_wait.execute(validation.value, {
        toolCallId: "tool-wait",
        messages: [],
        context: undefined,
      }),
    ).resolves.toMatchObject({ success: true, output: "Waited 2000ms locally" });

    expect(deps.sleep).toHaveBeenCalledWith(2_000);
  });

  test.each(["0", "2.5", "10001", "2000ms", " 2000"])(
    "rejects an invalid decimal-string wait duration: %s",
    async (duration) => {
      const browser = createLabBrowserHarness({}, dependencies());
      await expect(
        safeValidateTypes({
          value: { kind: "milliseconds", duration },
          schema: browser.tools.browser_wait.inputSchema,
        }),
      ).resolves.toMatchObject({ success: false });
    },
  );

  test("rejects invalid refs and non-HTTPS navigation before contacting Firecrawl", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.click("button.login")).rejects.toThrow("must look like @e1");
    await expect(browser.actions.navigate("http://example.com")).rejects.toThrow("must use HTTPS");
    await expect(browser.actions.navigate("https://name:secret@example.com")).rejects.toThrow(
      "must not contain credentials",
    );
    expect(deps.browserExecute).toHaveBeenCalledTimes(1);
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
    deps.browserExecute
      .mockImplementationOnce(async () => {
        await first;
        return interaction({ stdout: "first" });
      })
      .mockImplementationOnce(async () => interaction({ stdout: "second" }));

    const firstRun = browser.actions.getPage("url");
    const secondRun = browser.actions.snapshot();
    await vi.waitFor(() => expect(deps.browserExecute).toHaveBeenCalledTimes(2));
    releaseFirst?.();

    await expect(firstRun).resolves.toMatchObject({ output: "first" });
    await expect(secondRun).resolves.toMatchObject({ output: "second" });
    expect(deps.browserExecute).toHaveBeenCalledTimes(3);
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
    });
    expect(secondClose).toEqual(firstClose);
    expect(deps.deleteBrowser).toHaveBeenCalledTimes(1);
  });

  test("a close before open does not prevent later session cleanup", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.close()).resolves.toBeUndefined();
    await browser.open("https://example.com");
    await expect(browser.close()).resolves.toMatchObject({ success: true });

    expect(deps.deleteBrowser).toHaveBeenCalledTimes(1);
  });

  test("serializes a same-tick close behind the open it follows", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    const opening = browser.open("https://example.com");
    const closing = browser.close();
    await Promise.all([opening, closing]);

    expect(deps.browser).toHaveBeenCalledTimes(1);
    expect(deps.deleteBrowser).toHaveBeenCalledTimes(1);
  });

  test("shares one in-flight DELETE between concurrent close callers", async () => {
    const deps = dependencies();
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    deps.deleteBrowser.mockImplementationOnce(async () => {
      await closeGate;
      return {
        success: true,
        sessionDurationMs: 1_500,
        creditsBilled: 2,
      };
    });
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const firstClose = browser.close();
    const secondClose = browser.close();
    await vi.waitFor(() => expect(deps.deleteBrowser).toHaveBeenCalledTimes(1));
    releaseClose?.();

    await expect(Promise.all([firstClose, secondClose])).resolves.toHaveLength(2);
    expect(deps.deleteBrowser).toHaveBeenCalledTimes(1);
  });

  test("redacts provider URLs before returning tool output", async () => {
    const deps = dependencies();
    deps.browserExecute.mockResolvedValueOnce(
      interaction({ stdout: "watch https://sessions.firecrawl.dev/live?token=secret" }),
    );
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).resolves.toMatchObject({
      output: "watch [Firecrawl URL redacted]",
    });
  });

  test("removes credentials and query secrets from returned non-provider URLs", async () => {
    const deps = dependencies();
    deps.browserExecute.mockResolvedValueOnce(
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
    await selected.list_messages.execute({ limit: "5" }, options);
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
