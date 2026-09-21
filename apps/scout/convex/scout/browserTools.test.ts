import { asSchema, isStepCount, streamText, tool, type ToolSet } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { EventEmitter, once } from "node:events";
import {
  SdkError,
  type BrowserCreateResponse,
  type BrowserExecuteResponse,
  type Firecrawl,
} from "firecrawl";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createBrowserHarness, selectAgentMailTools } from "./browserTools";
import type { BrowserScreenshot, PlaywrightBrowser } from "./playwrightBrowser";
import { MAX_SCREENSHOT_NOTE_LENGTH } from "../tasks/screenshotModel";

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
    captureScreenshot: vi.fn<PlaywrightBrowser["captureScreenshot"]>(async (tabId) => ({
      bytes: Buffer.from("screenshot bytes stay outside tool output"),
      metadata: {
        tabId,
        url: "https://example.com/",
        title: "Example",
        startedAtMs: 10,
        completedAtMs: 20,
        width: 2560,
        height: 1600,
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 600 },
      },
    })),
    disconnect: vi.fn(async () => undefined),
    startClickCapture: vi.fn(async () => undefined),
    finishClickCapture: vi.fn<PlaywrightBrowser["finishClickCapture"]>(async () => ({
      kind: "unavailable",
    })),
    snapshot: vi.fn(async () => '- textbox "Email" [ref=e1]'),
    navigate: vi.fn(async () => undefined),
    getPage: vi.fn(async (kind: "url" | "title") =>
      kind === "url" ? "https://example.com/" : "Example",
    ),
    getElement: vi.fn(async () => "Conrad"),
    getElementAttribute: vi.fn(async () => "password"),
    fill: vi.fn(async () => undefined),
    observe: vi.fn(async () => ({ capturedAtMs: 1_020, tabs: [firstTab] })),
    selectTab: vi.fn<PlaywrightBrowser["selectTab"]>(async () => true),
    selectedTabId: vi.fn(async () => firstTab.tabId),
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
    deleteBrowser: vi.fn<Firecrawl["deleteBrowser"]>(async () => ({
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

type CaptureCallback = NonNullable<
  NonNullable<Parameters<typeof createBrowserHarness>[0]>["captureScreenshot"]
>;

function captureHarness(succeeded = true) {
  const playwright = runtime();
  const deps = dependencies(playwright);
  deps.browserExecute.mockResolvedValue({
    success: true,
    exitCode: 0,
    result: `__SCOUT_PLAYWRIGHT_RESULT__capture-step:${JSON.stringify(
      succeeded
        ? { ok: true, output: "action complete", activeTabId: "t2" }
        : { ok: false, output: "before failure", error: "Button missing", activeTabId: "t2" },
    )}`,
  });
  const saved: BrowserScreenshot[] = [];
  const captureScreenshot = vi.fn<CaptureCallback>(async ({ take, note }) => {
    const screenshot = await take();
    saved.push(screenshot);
    return { kind: "ready", captureId: "capture-1", note, metadata: screenshot.metadata };
  });
  const onOperationSettled = vi.fn(async () => undefined);
  const browser = createBrowserHarness(
    {
      captureScreenshot,
      onSessionCreated: async () => ({ captureOperations: true }),
      onOperationPrepared: async () => true,
      onOperationSettled,
    },
    deps,
  );
  return { browser, playwright, deps, captureScreenshot, onOperationSettled, saved };
}

describe("browser screenshot results", () => {
  test.each([
    { succeeded: true, snapshotFails: false },
    { succeeded: true, snapshotFails: true },
    { succeeded: false, snapshotFails: false },
    { succeeded: false, snapshotFails: true },
  ])(
    "retains ready capture independently of action=$succeeded and snapshot failure=$snapshotFails",
    async ({ succeeded, snapshotFails }) => {
      const { browser, playwright, deps, captureScreenshot, saved, onOperationSettled } =
        captureHarness(succeeded);
      await browser.open("https://example.com");
      playwright.snapshot.mockClear();
      if (snapshotFails) playwright.snapshot.mockRejectedValueOnce(new Error("ARIA unavailable"));

      const result = await browser.actions.executeCode(
        "return await browserState(target)",
        "capture-step",
        undefined,
        "Result screen",
      );

      expect(result).toMatchObject({
        success: succeeded && !snapshotFails,
        capture: {
          kind: "ready",
          captureId: "capture-1",
          note: "Result screen",
          metadata: { tabId: "t2", width: 2560, height: 1600 },
        },
      });
      if (succeeded && snapshotFails)
        expect(result).toMatchObject({ mutationApplied: true, doNotRetry: true });
      if (!succeeded) expect(result.error).toBe("Button missing");
      expect(saved).toHaveLength(1);
      expect(playwright.captureScreenshot).toHaveBeenCalledExactlyOnceWith("t2", undefined);
      expect(playwright.selectTab.mock.invocationCallOrder.at(-1)).toBeLessThan(
        captureScreenshot.mock.invocationCallOrder[0],
      );
      expect(captureScreenshot.mock.invocationCallOrder[0]).toBeLessThan(
        playwright.snapshot.mock.invocationCallOrder[0],
      );
      expect(JSON.stringify(result)).not.toContain("bytes");
      expect(JSON.stringify(result)).not.toContain(saved[0].bytes.toString("base64"));
      expect(deps.browserExecute).toHaveBeenCalledOnce();
      expect(onOperationSettled).toHaveBeenLastCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({
            kind: succeeded
              ? snapshotFails
                ? "applied_snapshot_failed"
                : "applied"
              : "indeterminate_after_dispatch",
          }),
        }),
      );
    },
  );

  test.each(["capture", "upload", "returned failure", "limit"])(
    "keeps a successful action applied when %s fails and permits another ordinary step",
    async (failure) => {
      const { browser, playwright, deps, captureScreenshot, onOperationSettled } = captureHarness();
      await browser.open("https://example.com");
      if (failure === "capture")
        playwright.captureScreenshot.mockRejectedValueOnce(new Error("Capture failed"));
      if (failure === "upload")
        captureScreenshot.mockImplementationOnce(async ({ take }) => {
          await take();
          throw new Error("R2 upload failed");
        });
      if (failure === "returned failure")
        captureScreenshot.mockResolvedValueOnce({ kind: "failed", message: "R2 upload failed" });
      if (failure === "limit")
        captureScreenshot.mockRejectedValueOnce(new Error("Task screenshot limit reached"));

      const result = await browser.actions.executeCode(
        "await page.getByRole('button').click()",
        "capture-step",
        undefined,
        "Result screen",
      );

      expect(result).toMatchObject({
        success: true,
        output: "action complete",
        error: null,
        capture: { kind: "failed" },
      });
      expect(onOperationSettled).toHaveBeenLastCalledWith(
        expect.objectContaining({ outcome: expect.objectContaining({ kind: "applied" }) }),
      );
      expect(deps.browserExecute).toHaveBeenCalledOnce();
      expect(captureScreenshot).toHaveBeenCalledOnce();
      expect(deps.sleep).not.toHaveBeenCalled();
      await browser.actions.executeCode("return await browserState(page)", "capture-step");
      expect(deps.browserExecute).toHaveBeenCalledTimes(2);
      expect(captureScreenshot).toHaveBeenCalledOnce();
    },
  );

  test("holds the exclusive operation through capture upload", async () => {
    const { browser, playwright, captureScreenshot } = captureHarness();
    await browser.open("https://example.com");
    playwright.snapshot.mockClear();
    const events = new EventEmitter();
    const entered = once(events, "entered");
    const release = once(events, "release");
    captureScreenshot.mockImplementationOnce(async ({ take, note }) => {
      const screenshot = await take();
      events.emit("entered");
      await release;
      return { kind: "ready", captureId: "capture-1", note, metadata: screenshot.metadata };
    });
    const pending = browser.actions.executeCode(
      "return await browserState(page)",
      "capture-step",
      undefined,
      "Stationary screen",
    );
    try {
      await entered;
      await expect(browser.actions.executeCode("return await browserState(page)")).rejects.toThrow(
        "Only one browser operation",
      );
      await expect(browser.actions.snapshot()).rejects.toThrow("Only one browser operation");
      expect(playwright.snapshot).not.toHaveBeenCalled();
    } finally {
      events.emit("release");
    }
    expect(await pending).toMatchObject({ success: true, capture: { kind: "ready" } });
  });

  test.each(["closed", "unreported", "request failure"])(
    "reports capture failure without selecting a fallback for %s target",
    async (failure) => {
      const { browser, playwright, deps, captureScreenshot } = captureHarness();
      await browser.open("https://example.com");
      if (failure === "closed") playwright.selectTab.mockResolvedValueOnce(false);
      if (failure === "unreported")
        deps.browserExecute.mockResolvedValueOnce({
          success: true,
          exitCode: 0,
          stdout: "legacy result",
        });
      if (failure === "request failure")
        deps.browserExecute.mockRejectedValueOnce(new Error("Provider connection lost"));

      const result = await browser.actions.executeCode(
        "return await browserState(target)",
        "capture-step",
        undefined,
        "Result screen",
      );

      expect(result).toMatchObject({ capture: { kind: "failed" } });
      expect(playwright.captureScreenshot).not.toHaveBeenCalled();
      expect(captureScreenshot).toHaveBeenCalledOnce();
      expect(deps.browserExecute).toHaveBeenCalledOnce();
    },
  );

  test("preserves a completed capture when post-action observation fails", async () => {
    const { browser, playwright, captureScreenshot } = captureHarness();
    await browser.open("https://example.com");
    playwright.observe
      .mockResolvedValueOnce({ capturedAtMs: 1_020, tabs: [firstTab] })
      .mockRejectedValueOnce(new Error("Observation lost"));
    const result = await browser.actions.executeCode(
      "return await browserState(page)",
      "capture-step",
      undefined,
      "Result screen",
    );
    expect(result).toMatchObject({
      success: false,
      capture: { kind: "ready", captureId: "capture-1" },
    });
    expect(captureScreenshot).toHaveBeenCalledOnce();
  });

  test("reserves a failed capture before settling a failed provider request", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    deps.browserExecute.mockRejectedValueOnce(new Error("Provider connection lost"));
    const preparedOperations = new Set<string>();
    const failedCaptures: string[] = [];
    const captureScreenshot = vi.fn<CaptureCallback>(async ({ toolCallId, take }) => {
      // screenshotRecords.prepare accepts only an operation that is still prepared.
      expect(preparedOperations.has(toolCallId)).toBe(true);
      try {
        await take();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        failedCaptures.push(error.message);
        return { kind: "failed", message: error.message };
      }
      throw new Error("A failed provider request must not take a screenshot");
    });
    const browser = createBrowserHarness(
      {
        captureScreenshot,
        onSessionCreated: async () => ({ captureOperations: true }),
        onOperationPrepared: async ({ toolCallId }) => {
          preparedOperations.add(toolCallId);
          return true;
        },
        onOperationSettled: async ({ toolCallId }) => {
          preparedOperations.delete(toolCallId);
        },
      },
      deps,
    );
    await browser.open("https://example.com");

    const result = await browser.actions.executeCode(
      "return await browserState(page)",
      "failed-request",
      undefined,
      "Result screen",
    );

    const message = "Screenshot target could not be confirmed after the Playwright request failed";
    expect(result).toMatchObject({
      success: false,
      error: "Firecrawl Playwright request failed: Provider connection lost",
      capture: { kind: "failed", message },
    });
    expect(failedCaptures).toEqual([message]);
    expect(preparedOperations.size).toBe(0);
    expect(captureScreenshot).toHaveBeenCalledOnce();
    expect(playwright.captureScreenshot).not.toHaveBeenCalled();
    expect(deps.browserExecute).toHaveBeenCalledOnce();
  });

  test("exposes nullable captureNote only on configured harnesses and retains ordinary tool calls", async () => {
    const { browser, captureScreenshot } = captureHarness();
    const legacy = createBrowserHarness({}, dependencies());
    const schema = await asSchema(browser.tools.browser_execute.inputSchema).jsonSchema;
    const legacySchema = await asSchema(legacy.tools.browser_execute.inputSchema).jsonSchema;
    expect(schema.required).toEqual(["code", "captureNote"]);
    expect(schema.properties).toHaveProperty("captureNote");
    expect(legacySchema.required).toEqual(["code"]);
    expect(legacySchema.properties).not.toHaveProperty("captureNote");
    expect(legacy.tools.browser_execute.description).not.toContain("captureNote");
    expect(browser.tools.browser_execute.description).not.toContain("input_image");
    await browser.open("https://example.com");
    expect(
      await browser.tools.browser_execute.execute(
        { code: "return await browserState(page)", captureNote: null },
        { toolCallId: "capture-step", messages: [], context: undefined },
      ),
    ).not.toHaveProperty("capture");
    expect(captureScreenshot).not.toHaveBeenCalled();
    await expect(
      browser.actions.executeCode(
        "return 1",
        "capture-step",
        undefined,
        "x".repeat(MAX_SCREENSHOT_NOTE_LENGTH + 1),
      ),
    ).rejects.toThrow();
    await expect(
      browser.actions.executeCode("return 1", "capture-step", undefined, "  "),
    ).rejects.toThrow();
  });
});

describe("Lab browser harness", () => {
  test("disconnect releases the local connection without closing the remote session", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    const browser = createBrowserHarness({ profileName: "scout-conrad" }, deps);
    await browser.open("https://example.com");

    await browser.disconnect();

    expect(playwright.disconnect).toHaveBeenCalledOnce();
    expect(deps.deleteBrowser).not.toHaveBeenCalled();
    await expect(browser.actions.getPage("url")).rejects.toThrow("finished accepting operations");
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

  test("does not create a Firecrawl session after the model turn stops", async () => {
    const deps = dependencies();
    const browser = createBrowserHarness(
      {
        beforeDispatch: async () => {
          throw new Error("Scout turn is no longer running");
        },
      },
      deps,
    );

    await expect(browser.open("https://example.com")).rejects.toThrow(
      "Scout turn is no longer running",
    );
    expect(deps.browser).not.toHaveBeenCalled();
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
    expect(executionRequest?.[1].code).toContain('const selectedTabId = "t1"');
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
      selectedTabId: "t1",
      toolCallId: "tool-execute",
      clickCapture: { kind: "unavailable" },
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
        selectedTabId: "t1",
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

  test("uses the reported tab for the error snapshot, persistence, and next execution", async () => {
    const playwright = runtime();
    let selected = "t1";
    playwright.selectTab.mockImplementation(async (tabId: string) => {
      selected = tabId;
      return true;
    });
    playwright.selectedTabId.mockImplementation(async () => selected);
    playwright.snapshot.mockImplementation(async () => `Snapshot of ${selected}`);
    playwright.observe.mockImplementation(async () => ({
      capturedAtMs: 1_020,
      tabs: [
        { ...firstTab, active: selected === "t1" },
        { ...firstTab, tabId: "t2", active: selected === "t2" },
      ],
    }));
    const deps = dependencies(playwright);
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      result:
        '__SCOUT_PLAYWRIGHT_RESULT__switch:{"ok":false,"output":"","error":"Missing button","activeTabId":"t2"}',
    });
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

    const result = await browser.actions.executeCode(
      "await browserState(target); throw new Error('Missing button')",
      "switch",
    );
    expect(result).toMatchObject({
      success: false,
      error: "Missing button",
      currentPage: "Snapshot of t2",
    });
    expect(onOperationSettled).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedTabId: "t2" }),
    );
    await browser.actions.executeCode("return await browserState(page)", "next");
    expect(deps.browserExecute.mock.calls.at(-1)?.[1].code).toContain('const selectedTabId = "t2"');
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

  test("saves complete redacted execution and page text before returning previews", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    const saved = new Map<string, string>();
    const saveExecutionResult = vi.fn(
      async ({ toolCallId, text }: { toolCallId: string; text: string }) => {
        const path = `/workspace/browser-results/${toolCallId}.json`;
        saved.set(path, text);
        return path;
      },
    );
    const browser = createBrowserHarness({ saveExecutionResult }, deps);
    await browser.open("https://example.com");
    const secret = 'managed"password\\value';
    browser.actions.registerSensitiveValue(secret);
    const output = `${"x".repeat(25_000)}${secret}\nOUTPUT-END`;
    const snapshot = `${"p".repeat(25_000)}${encodeURIComponent(secret)}\nPAGE-END`;
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      result: `__SCOUT_PLAYWRIGHT_RESULT__first:${JSON.stringify({ ok: true, output, activeTabId: "t1" })}`,
      exitCode: 0,
    });
    playwright.snapshot.mockResolvedValueOnce(snapshot);
    const result = await browser.actions.executeCode("return 'large result'", "first");

    expect(result).toMatchObject({
      success: true,
      currentPageTruncated: true,
      outputTruncated: true,
      resultFile: { status: "saved", path: "/workspace/browser-results/first.json" },
    });
    expect(result.currentPage).toHaveLength(4_000);
    expect(result.output).toHaveLength(4_000);
    const text = saved.get("/workspace/browser-results/first.json");
    expect(text).toBeDefined();
    expect(JSON.parse(text!)).toMatchObject({
      success: true,
      currentPage: `${"p".repeat(25_000)}[secret redacted]\nPAGE-END`,
      output: `${"x".repeat(25_000)}[secret redacted]\nOUTPUT-END`,
    });
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encodeURIComponent(secret));
    await browser.actions.executeCode("return 'next result'", "second");
    expect(saved.get("/workspace/browser-results/first.json")).toBe(text);
    expect(saved.size).toBe(2);
  });

  test("reports a workspace failure without changing the action outcome or repeating it", async () => {
    const deps = dependencies();
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      stdout: "x".repeat(12_000),
      exitCode: 0,
    });
    const browser = createBrowserHarness(
      {
        saveExecutionResult: async () => {
          throw new Error("Workspace file limit exceeded");
        },
      },
      deps,
    );
    await browser.open("https://example.com");
    const result = await browser.actions.executeCode("await page.getByRole('button').click()");
    expect(result).toMatchObject({
      success: true,
      output: "x".repeat(12_000),
      outputTruncated: false,
      error: null,
      resultFile: { status: "failed", error: "Workspace file limit exceeded" },
    });
    expect(deps.browserExecute).toHaveBeenCalledTimes(1);
  });

  test("preserves execution output when the post-action snapshot fails", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    const saveExecutionResult = vi.fn(
      async (_args: { toolCallId: string; text: string }) =>
        "/workspace/browser-results/first.json",
    );
    const browser = createBrowserHarness({ saveExecutionResult }, deps);
    await browser.open("https://example.com");
    playwright.snapshot.mockRejectedValueOnce(new Error("Snapshot disconnected"));
    const result = await browser.actions.executeCode("await page.getByRole('button').click()");
    expect(result).toMatchObject({
      success: false,
      output: "clicked",
      error: "PostActionSnapshotFailed: Snapshot disconnected",
      mutationApplied: true,
      doNotRetry: true,
      resultFile: { status: "saved" },
    });
    expect(JSON.parse(saveExecutionResult.mock.calls[0][0].text)).toMatchObject({
      output: "clicked",
      mutationApplied: true,
      doNotRetry: true,
    });
    expect(deps.browserExecute).toHaveBeenCalledTimes(1);
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
      selectedTabId: "t1",
      toolCallId: "local-2",
      clickCapture: { kind: "unavailable" },
      outcome: {
        kind: "indeterminate_after_dispatch",
        failure: expect.stringContaining("not found"),
        executionFinished: true,
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
      result:
        '__SCOUT_PLAYWRIGHT_RESULT__tool-current:{"ok":true,"output":"clicked","activeTabId":"t1"}',
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
        '__SCOUT_PLAYWRIGHT_RESULT__tool-current:{"ok":false,"output":"before click","error":"locator was ambiguous","activeTabId":"t1"}',
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

  test("drains browser execution and settlement after the SDK abandons an aborted parallel tool", async () => {
    const events = new EventEmitter();
    const started = once(events, "started");
    const releaseBrowser = once(events, "releaseBrowser");
    const releaseOther = once(events, "releaseOther");
    const settlementStarted = once(events, "settlementStarted");
    const releaseSettlement = once(events, "releaseSettlement");
    const deps = dependencies();
    deps.browserExecute.mockImplementationOnce(async () => {
      events.emit("started");
      await releaseBrowser;
      return { success: true, exitCode: 0, stdout: "finished", killed: false };
    });
    const browser = createBrowserHarness(
      {
        onSessionCreated: async () => ({ captureOperations: true }),
        onOperationPrepared: async () => true,
        onOperationSettled: async ({ toolCallId }) => {
          if (toolCallId === "browser-call") {
            events.emit("settlementStarted");
            await releaseSettlement;
          }
        },
      },
      deps,
    );
    await browser.open("https://example.com");
    const abort = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "browser-call",
            toolName: "browser_execute",
            input: JSON.stringify({ code: "await page.locator('button').click()" }),
          },
          { type: "tool-call", toolCallId: "other-call", toolName: "other_tool", input: "{}" },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ]),
      },
    });
    const result = streamText({
      model,
      tools: {
        ...browser.tools,
        other_tool: tool({
          inputSchema: z.object({}),
          execute: async () => {
            await releaseOther;
            return "finished";
          },
        }),
      },
      prompt: "Inspect the page and another resource",
      abortSignal: abort.signal,
      stopWhen: isStepCount(1),
    });
    const consumed = result.consumeStream();
    await started;
    abort.abort(new Error("slice deadline expired"));
    events.emit("releaseOther");
    await consumed;
    await expect(result.steps).rejects.toThrow();
    const drained = vi.fn();
    const finished = browser.drain().then(drained);
    await expect(browser.actions.executeCode("await page.title()")).rejects.toThrow(
      "finished accepting operations",
    );
    expect(drained).not.toHaveBeenCalled();
    events.emit("releaseBrowser");
    await settlementStarted;
    expect(drained).not.toHaveBeenCalled();
    events.emit("releaseSettlement");
    await finished;
    expect(drained).toHaveBeenCalledOnce();
    await expect(
      browser.tools.browser_close.execute(
        {},
        { toolCallId: "late-close", messages: [], context: undefined },
      ),
    ).rejects.toThrow("finished accepting operations");
    expect(deps.deleteBrowser).not.toHaveBeenCalled();
    await browser.close();
    expect(deps.deleteBrowser).toHaveBeenCalledOnce();
  });

  test("allows recovery after a rejected handoff and seals browser tools after a successful transfer", async () => {
    const deps = dependencies();
    const browser = createBrowserHarness({}, deps);
    await expect(
      browser.transferControl(async () => {
        throw new Error("No browser session is open");
      }),
    ).rejects.toThrow("No browser session is open");
    await browser.open("https://example.com");
    await browser.transferControl(async () => {
      await expect(browser.actions.executeCode("await page.title()")).rejects.toThrow(
        "Only one browser operation",
      );
    });
    await expect(browser.actions.executeCode("await page.title()")).rejects.toThrow(
      "finished accepting operations",
    );
    await expect(
      browser.tools.browser_close.execute(
        {},
        { toolCallId: "late-close", messages: [], context: undefined },
      ),
    ).rejects.toThrow("finished accepting operations");
    expect(deps.deleteBrowser).not.toHaveBeenCalled();
    await browser.close();
    expect(deps.deleteBrowser).toHaveBeenCalledOnce();
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
      selectedTabId: "t1",
      toolCallId: "tool-canceled-before-navigation",
      clickCapture: { kind: "unavailable" },
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

  test("redacts supplied passwords in raw, URL-encoded, and JSON-escaped browser output", async () => {
    const playwright = runtime();
    const deps = dependencies(playwright);
    const browser = createBrowserHarness({}, deps);
    await browser.open("https://example.com");
    const password = 'quote"backslash\\line\nbreak';
    browser.actions.registerSensitiveValue(password);
    deps.browserExecute.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: [password, encodeURIComponent(password), JSON.stringify({ password })].join("\n"),
    });
    const result = await browser.actions.executeCode(
      "return { password: await page.getByLabel('Password').inputValue() }",
    );
    expect(result).toMatchObject({
      success: true,
      output: '[secret redacted]\n[secret redacted]\n{"password":"[secret redacted]"}',
    });
  });

  test("keeps browser diagnostics useful while masking restored passwords", async () => {
    const playwright = runtime();
    const browser = createBrowserHarness({}, dependencies(playwright));
    await browser.open("https://example.com");
    const password = 'quote"backslash\\line\nbreak';
    browser.actions.registerSensitiveValue(password);
    playwright.getElement.mockRejectedValueOnce(
      new Error(
        `Locator matched two elements: ${password}, ${encodeURIComponent(password)}, ${JSON.stringify(password)}`,
      ),
    );

    await expect(browser.actions.getElement(passwordTarget)).rejects.toThrow(
      'Locator matched two elements: [secret redacted], [secret redacted], "[secret redacted]"',
    );
    playwright.fill.mockRejectedValueOnce(new Error(`fill failed: ${password.slice(0, 8)}`));
    await expect(browser.actions.fillManagedPassword({ passwordTarget }, password)).rejects.toThrow(
      "Managed password fill failed",
    );
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

  test("closes a provider browser that has no CDP URL", async () => {
    const deps = dependencies();
    deps.browser.mockResolvedValueOnce({ success: true, id: "session-1" });
    const browser = createBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).rejects.toThrow("without a CDP URL");
    expect(deps.deleteBrowser).toHaveBeenCalledExactlyOnceWith("session-1");
    await expect(browser.close()).resolves.toBeUndefined();
  });

  test("reports the browser ID when setup and cleanup both fail", async () => {
    const deps = dependencies();
    deps.browser.mockResolvedValueOnce({ success: true, id: "session-1" });
    deps.deleteBrowser.mockResolvedValueOnce({ success: false, error: "provider unavailable" });
    const browser = createBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).rejects.toThrow(
      "Browser session-1 has no CDP URL and cleanup failed",
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
  test("omits unused pagination values instead of forwarding an invalid empty cursor", async () => {
    const execute = vi.fn(async (input: unknown) => input);
    const readTool = tool({
      inputSchema: z.object({
        inboxId: z.string(),
        q: z.string().optional(),
        limit: z.number().optional(),
        pageToken: z.string().min(1).optional(),
      }),
      execute,
      toModelOutput: () => ({ type: "text", value: "messages" }),
    });
    const selected = selectAgentMailTools(
      { list_messages: readTool, search_messages: readTool, get_thread: readTool },
      "magda@agentmail.to",
      async () => {},
    );
    const options = { toolCallId: "tool-1", messages: [], context: undefined };

    await selected.list_messages.execute({}, options);
    await selected.search_messages.execute({ q: "GitHub", limit: null, pageToken: "" }, options);
    await selected.list_messages.execute({ limit: null, pageToken: null }, options);
    await selected.list_messages.execute({ limit: 5, pageToken: "returned-cursor" }, options);

    expect(execute.mock.calls.map(([input]) => input)).toEqual([
      { inboxId: "magda@agentmail.to" },
      { inboxId: "magda@agentmail.to", q: "GitHub" },
      { inboxId: "magda@agentmail.to" },
      { inboxId: "magda@agentmail.to", limit: 5, pageToken: "returned-cursor" },
    ]);
  });

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
    const selected = selectAgentMailTools(allTools, "conrad@agentmail.to", async () => {});
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
