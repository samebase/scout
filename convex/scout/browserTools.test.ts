import { tool, type ToolSet } from "ai";
import {
  SdkError,
  type BrowserCreateResponse,
  type BrowserExecuteResponse,
  type Firecrawl,
} from "firecrawl";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import { BROWSER_EXECUTE_DESCRIPTION, BROWSER_STATE_HELPER_SOURCE } from "./browserToolContract";
import type { PlaywrightBrowser } from "./playwrightBrowser";

const firstTab = {
  tabId: "t1",
  title: "Example",
  url: "https://example.com/",
  active: true,
};
const passwordTarget = {
  kind: "role",
  role: "textbox",
  name: "Password",
  exact: true,
} as const;

function runtime() {
  return {
    snapshot: vi.fn(async () => '- textbox "Email" [ref=e1]'),
    navigate: vi.fn(async () => undefined),
    getPage: vi.fn(async (kind: "url" | "title") =>
      kind === "url" ? "https://example.com/" : "Example",
    ),
    getElement: vi.fn(async () => "Conrad"),
    getElementAttribute: vi.fn(async () => "password"),
    fill: vi.fn(async () => undefined),
    observe: vi.fn(async () => ({ capturedAtMs: 1_020, tabs: [firstTab] })),
  } satisfies PlaywrightBrowser;
}

function dependencies(browserRuntime = runtime()) {
  let timestamp = 1_000;
  return {
    browser: vi.fn(
      async (): Promise<BrowserCreateResponse> => ({
        success: true,
        id: "session-1",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      }),
    ),
    browserExecute: vi.fn(
      async (
        _sessionId: string,
        _options: Parameters<Firecrawl["browserExecute"]>[1],
      ): Promise<BrowserExecuteResponse> => ({
        success: true,
        stdout: "clicked",
        exitCode: 0,
        killed: false,
      }),
    ),
    connect: vi.fn(async () => browserRuntime),
    deleteBrowser: vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
    })),
    now: vi.fn(() => {
      timestamp += 10;
      return timestamp;
    }),
    sleep: vi.fn(async () => undefined),
  };
}

describe("Lab browser harness", () => {
  test("documents the browserState helper in the browser tool contract", () => {
    expect(BROWSER_EXECUTE_DESCRIPTION).toContain(BROWSER_STATE_HELPER_SOURCE);
    expect(BROWSER_EXECUTE_DESCRIPTION).toContain("return await browserState(page)");
  });

  test("opens Firecrawl once and keeps its CDP and live-view URLs outside model output", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    deps.browser.mockResolvedValueOnce({
      success: true,
      id: "session-1",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      liveViewUrl: "https://liveview.firecrawl.dev/private?signature=read-only",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });
    const onSessionCreated = vi.fn(async () => undefined);
    const onLiveViewAvailable = vi.fn(async () => undefined);
    const onInteractiveLiveViewAvailable = vi.fn(async () => undefined);
    const browser = createBrowserHarness(
      {
        profileName: "scout-conrad",
        onSessionCreated,
        onLiveViewAvailable,
        onInteractiveLiveViewAvailable,
      },
      deps,
    );

    const output = await browser.open("https://example.com/login");

    expect(deps.browser).toHaveBeenCalledWith({
      activityTtl: 3_600,
      profile: { name: "scout-conrad", saveChanges: true },
      streamWebView: true,
      ttl: 3_600,
    });
    expect(deps.connect).toHaveBeenCalledExactlyOnceWith(
      "wss://browser.firecrawl.dev/cdp?token=secret",
      undefined,
    );
    expect(playwright.navigate).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/login",
      undefined,
    );
    expect(onLiveViewAvailable).toHaveBeenCalledOnce();
    expect(onInteractiveLiveViewAvailable).toHaveBeenCalledOnce();
    expect(onSessionCreated).toHaveBeenCalledExactlyOnceWith({
      providerSessionId: "session-1",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
      providerExpiresAtMs: 3_601_010,
    });
    expect(JSON.stringify(output)).not.toContain("firecrawl.dev");
  });

  test("lets the model execute Playwright code in Firecrawl's Node sandbox", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    const onOperationPrepared = vi.fn(async () => true);
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createBrowserHarness(
      {
        onSessionCreated: async () => ({ captureOperations: true }),
        onOperationPrepared,
        onOperationSettled,
      },
      deps,
    );
    await browser.open("https://example.com");
    onOperationPrepared.mockClear();
    onOperationSettled.mockClear();
    const code =
      "await page.getByRole('link', { name: 'Dashboard' }).filter({ visible: true }).first().click();";

    const result = await browser.actions.executeCode(code, "tool-execute");

    expect(deps.browserExecute).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      expect.objectContaining({
        code: expect.stringContaining(code),
        language: "node",
        timeout: 60,
      }),
    );
    expect(JSON.stringify(deps.browserExecute.mock.calls)).toContain(
      "__SCOUT_PLAYWRIGHT_RESULT__tool-execute:",
    );
    const executionRequest = deps.browserExecute.mock.calls.at(-1);
    expect(executionRequest?.[1].code).toContain(
      'const selectedTab = {"index":0,"title":"Example","url":"https://example.com/"}',
    );
    expect(executionRequest?.[1].code).toContain("const browserState = async");
    expect(executionRequest?.[1].code).toContain(
      'new AsyncFunction("page", "browserState", "return (" + source + ");")',
    );
    expect(executionRequest?.[1].code).toContain("executeUserCode(activePage, browserState)");
    expect(executionRequest?.[1].code).toContain("activePage.setDefaultTimeout(10000)");
    expect(executionRequest?.[1].code).toContain("activePage.setDefaultNavigationTimeout(30000)");
    expect(onOperationPrepared).toHaveBeenCalledWith({
      toolCallId: "tool-execute",
      action: { kind: "execute", code },
    });
    expect(onOperationSettled).toHaveBeenCalledWith({
      toolCallId: "tool-execute",
      outcome: {
        kind: "applied",
        telemetry: {
          version: 1,
          before: { capturedAtMs: 1_020, tabs: [firstTab] },
          dispatchedAtMs: expect.any(Number),
          returnedAtMs: expect.any(Number),
          after: { capturedAtMs: 1_020, tabs: [firstTab] },
        },
      },
    });
    expect(result).toMatchObject({
      success: true,
      output: expect.stringContaining("clicked"),
      currentPage: expect.stringContaining('textbox "Email"'),
    });
  });

  test("reconnects to an existing Firecrawl session for a later execution", async () => {
    const deps = dependencies();
    const onOperationPrepared = vi.fn(async () => true);
    const browser = createBrowserHarness(
      {
        onOperationPrepared,
        onOperationSettled: async () => undefined,
      },
      deps,
    );

    await browser.attach(
      {
        providerSessionId: "session-existing",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
        interactiveLiveViewUrl: null,
      },
      { captureOperations: true },
    );
    await browser.actions.executeCode("return await page.title()", "tool-reconnected");

    expect(deps.browser).not.toHaveBeenCalled();
    expect(deps.connect).toHaveBeenCalledExactlyOnceWith(
      "wss://browser.firecrawl.dev/cdp?token=secret",
      undefined,
    );
    expect(onOperationPrepared).toHaveBeenCalledExactlyOnceWith({
      toolCallId: "tool-reconnected",
      action: { kind: "execute", code: "return await page.title()" },
    });
    expect(deps.browserExecute).toHaveBeenCalledWith(
      "session-existing",
      expect.objectContaining({ language: "node", timeout: 60 }),
    );
  });

  test("exposes session lifecycle and ordinary Playwright execution", () => {
    const browser = createBrowserHarness({}, dependencies());
    expect(Object.keys(browser.tools)).toEqual([
      "create_new_firecrawl_session",
      "browser_execute",
      "browser_close",
    ]);
    expect(browser.tools).not.toHaveProperty("browser_open");
  });

  test("keeps command output separate from the current page", async () => {
    const deps = dependencies();
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      stdout: "x".repeat(20_000),
      exitCode: 0,
      killed: false,
    });
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const result = await browser.actions.executeCode("console.log('noisy')");

    expect(result.currentPage).toContain('textbox "Email"');
    expect(result.output).toHaveLength(20_000);
  });

  test("records failed code without killing the rest of the browser session", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    deps.browserExecute
      .mockResolvedValueOnce({
        success: true,
        exitCode: 1,
        stderr: "locator was not found",
      })
      .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: "recovered" });
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createBrowserHarness(
      {
        onSessionCreated: async () => ({ captureOperations: true }),
        onOperationPrepared: async () => true,
        onOperationSettled,
      },
      deps,
    );
    await browser.open("https://example.com");
    onOperationSettled.mockClear();

    await expect(
      browser.actions.executeCode("await page.locator('missing').click()"),
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
    expect(onOperationSettled).toHaveBeenLastCalledWith({
      toolCallId: "local-2",
      outcome: {
        kind: "indeterminate_after_dispatch",
        failure: expect.stringContaining("not found"),
      },
    });

    await expect(
      browser.actions.executeCode("console.log(await page.url())"),
    ).resolves.toMatchObject({ success: true, output: expect.stringContaining("recovered") });
  });

  test("uses the current scoped result instead of stale REPL stderr", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      exitCode: 1,
      stderr: "an earlier execution failed",
      result: '__SCOUT_PLAYWRIGHT_RESULT__tool-current:{"ok":true,"output":"clicked"}',
    });
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(
      browser.actions.executeCode("await page.click('button')", "tool-current"),
    ).resolves.toMatchObject({ success: true, output: expect.stringContaining("clicked") });
  });

  test("reports a runtime failure captured inside the scoped execution", async () => {
    const deps = dependencies();
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      result:
        '__SCOUT_PLAYWRIGHT_RESULT__tool-current:{"ok":false,"output":"before click","error":"locator was ambiguous"}',
    });
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(
      browser.actions.executeCode("await page.click('button')", "tool-current"),
    ).resolves.toMatchObject({
      success: false,
      output: expect.stringContaining("before click"),
      error: "locator was ambiguous",
    });
  });

  test("retries one Firecrawl rate-limit rejection after its stated delay", async () => {
    const deps = dependencies();
    deps.browserExecute
      .mockRejectedValueOnce(new SdkError("Rate limit exceeded; please retry after 2s", 429))
      .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: "recovered" });
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.executeCode("console.log('ok')")).resolves.toMatchObject({
      success: true,
    });
    expect(deps.sleep).toHaveBeenCalledExactlyOnceWith(2_250);
    expect(deps.browserExecute).toHaveBeenCalledTimes(2);
  });

  test("does not retry a rate-limited execution after its model turn is aborted", async () => {
    const abortController = new AbortController();
    const deps = dependencies();
    deps.browserExecute
      .mockImplementationOnce(async () => {
        abortController.abort(new Error("model turn timed out"));
        throw new SdkError("Rate limit exceeded; please retry after 2s", 429);
      })
      .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: "retried" });
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(
      browser.tools.browser_execute.execute(
        { code: "return await page.title()" },
        {
          toolCallId: "tool-aborted-execute",
          messages: [],
          context: undefined,
          abortSignal: abortController.signal,
        },
      ),
    ).rejects.toThrow("model turn timed out");
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.browserExecute).toHaveBeenCalledOnce();
  });

  test("rejects concurrent browser operations instead of building an unbounded queue", async () => {
    const deps = dependencies();
    let finishExecution: (() => void) | undefined;
    deps.browserExecute.mockImplementationOnce(
      async () =>
        await new Promise<BrowserExecuteResponse>((resolve) => {
          finishExecution = () =>
            resolve({ success: true, exitCode: 0, stdout: "finished", killed: false });
        }),
    );
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const first = browser.actions.executeCode("await page.locator('button').click()");
    await expect(browser.actions.executeCode("await page.title()")).rejects.toThrow(
      "one browser operation",
    );
    finishExecution?.();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  test("waits for a persistent profile writer before opening one session", async () => {
    const deps = dependencies();
    const profileBusy = new SdkError(
      "Another session is currently writing to this profile. Only one writer is allowed at a time.",
      409,
    );
    deps.browser
      .mockRejectedValueOnce(profileBusy)
      .mockRejectedValueOnce(profileBusy)
      .mockResolvedValueOnce({
        success: true,
        id: "session-1",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      });
    const browser = createBrowserHarness({ profileName: "scout-conrad" }, deps);

    await expect(browser.open("https://example.com")).resolves.toMatchObject({ success: true });
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenNthCalledWith(1, 10_000);
    expect(deps.sleep).toHaveBeenNthCalledWith(2, 10_000);
    expect(deps.browser).toHaveBeenCalledTimes(3);
  });

  test("does not retry a profile-busy open after its model turn is aborted", async () => {
    const abortController = new AbortController();
    const deps = dependencies();
    deps.browser
      .mockImplementationOnce(async () => {
        abortController.abort(new Error("model turn timed out"));
        throw new SdkError(
          "Another session is currently writing to this profile. Only one writer is allowed at a time.",
          409,
        );
      })
      .mockResolvedValueOnce({
        success: true,
        id: "session-retried",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      });
    const browser = createBrowserHarness({ profileName: "scout-conrad" }, deps);

    await expect(
      browser.tools.create_new_firecrawl_session.execute(
        { url: "https://example.com" },
        {
          toolCallId: "tool-aborted-open",
          messages: [],
          context: undefined,
          abortSignal: abortController.signal,
        },
      ),
    ).rejects.toThrow("model turn timed out");
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.browser).toHaveBeenCalledOnce();
  });

  test("does not dispatch a prepared browser mutation after cancellation", async () => {
    const controller = new AbortController();
    const playwright = runtime();
    const deps = dependencies(playwright);
    const onOperationSettled = vi.fn(async () => undefined);
    const browser = createBrowserHarness(
      {
        onSessionCreated: async () => ({ captureOperations: true }),
        onOperationPrepared: async () => {
          controller.abort(new Error("Scout slice expired"));
          return true;
        },
        onOperationSettled,
      },
      deps,
    );

    await expect(
      browser.tools.create_new_firecrawl_session.execute(
        { url: "https://example.com" },
        {
          toolCallId: "tool-canceled-before-navigation",
          messages: [],
          context: undefined,
          abortSignal: controller.signal,
        },
      ),
    ).rejects.toThrow("Scout slice expired");
    expect(playwright.navigate).not.toHaveBeenCalled();
    expect(onOperationSettled).toHaveBeenCalledExactlyOnceWith({
      toolCallId: "tool-canceled-before-navigation",
      outcome: {
        kind: "failed_before_dispatch",
        failure: expect.stringContaining("Scout slice expired"),
      },
    });
    await browser.close();
  });

  test("fills managed passwords through trusted local Playwright without exposing them", async () => {
    const playwright = runtime();
    const browser = createBrowserHarness({}, dependencies(playwright));
    await browser.open("https://example.com");
    const password = "NeverEchoThis!42";
    browser.actions.registerSensitiveValue(password);
    playwright.snapshot.mockResolvedValueOnce(`- textbox "Password" value="${password}"`);

    const result = await browser.actions.fillManagedPassword(
      { passwordTarget, passwordConfirmationTarget: passwordTarget },
      password,
    );

    expect(playwright.fill).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  test("rejects unsafe URLs and cleans up a failed CDP connection", async () => {
    const deps = dependencies();
    deps.connect.mockRejectedValueOnce(new Error("websocket refused"));
    const browser = createBrowserHarness({}, deps);

    await expect(browser.open("http://example.com")).rejects.toThrow("must use HTTPS");
    await expect(browser.open("https://example.com")).rejects.toThrow(
      "Playwright could not connect",
    );
    expect(deps.deleteBrowser).toHaveBeenCalledExactlyOnceWith("session-1");
  });

  test("closes a provider session when the app cannot register it", async () => {
    const deps = dependencies();
    const registrationFailure = new Error("database unavailable");
    const browser = createBrowserHarness(
      {
        onSessionCreated: async () => {
          throw registrationFailure;
        },
      },
      deps,
    );

    await expect(browser.open("https://example.com")).rejects.toBe(registrationFailure);
    expect(deps.deleteBrowser).toHaveBeenCalledExactlyOnceWith("session-1");
    await expect(browser.close()).resolves.toBeUndefined();
  });

  test("closes a successful Firecrawl session once", async () => {
    const deps = dependencies();
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const first = await browser.close();
    const second = await browser.close();

    expect(first).toEqual({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
    });
    expect(second).toEqual(first);
    expect(deps.deleteBrowser).toHaveBeenCalledOnce();
  });
});

describe("AgentMail Lab catalog", () => {
  test("binds the read tools to one configured inbox", async () => {
    const execute = vi.fn(async (input: unknown) => input);
    const toModelOutput = vi.fn(() => ({ type: "text" as const, value: "converted" }));
    const readTool = tool({
      inputSchema: z.object({
        inboxId: z.string(),
        limit: z.number().optional(),
        q: z.string().optional(),
        threadId: z.string().optional(),
      }),
      execute,
      toModelOutput,
    });
    const allTools: ToolSet = {
      list_messages: readTool,
      search_messages: readTool,
      get_thread: readTool,
    };
    const selected = selectAgentMailTools(allTools, "conrad@agentmail.to");
    const options = { toolCallId: "tool-1", messages: [], context: undefined };

    await selected.list_messages.execute({ limit: 5 }, options);
    await selected.search_messages.execute({ q: "verification" }, options);
    await selected.get_thread.execute({ threadId: "thread-1" }, options);

    expect(execute).toHaveBeenNthCalledWith(
      1,
      { inboxId: "conrad@agentmail.to", limit: 5 },
      options,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      { inboxId: "conrad@agentmail.to", q: "verification" },
      options,
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      { inboxId: "conrad@agentmail.to", threadId: "thread-1" },
      options,
    );
  });
});
