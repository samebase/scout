import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { chromium, type Dialog } from "playwright-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { omitNullish } from "../../shared/omitNullish";
import { browserTargetSchema } from "./browserTarget";
import { connectPlaywrightBrowser } from "./playwrightBrowser";
import { MAX_SCREENSHOT_BYTES } from "../agentsApi/screenshotModel";

function pngHeader(width = 2560, height = 1600, byteLength = 33) {
  const bytes = Buffer.alloc(byteLength);
  bytes.write("89504e470d0a1a0a", 0, "hex");
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function fakePage(
  url: string,
  snapshot: string,
  initiallyFocused = false,
  targetId = `target:${url}`,
) {
  const focus = { current: initiallyFocused };
  const location = { current: url };
  const frame = {};
  const events = new EventEmitter<{ framenavigated: [object] }>();
  const fill = vi.fn(async () => undefined);
  const filter = vi.fn();
  const first = vi.fn();
  const semanticLocator = {
    fill,
    filter,
    first,
    getAttribute: vi.fn(async () => "password"),
    innerText: vi.fn(async () => "Conrad"),
  };
  filter.mockReturnValue(semanticLocator);
  first.mockReturnValue(semanticLocator);
  const ariaSnapshot = vi.fn(async () => snapshot);
  const bodyLocator = {
    ariaSnapshot,
  };
  const getByRole = vi.fn(() => semanticLocator);
  const page = {
    targetId,
    loaderId: "loader-1",
    viewport: { pageX: 125, pageY: 600, clientWidth: 1280, clientHeight: 800, scale: 1 },
    mainFrame: () => frame,
    on: events.on.bind(events),
    off: events.off.bind(events),
    bringToFront: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => focus.current),
    getByRole,
    goto: vi.fn(async () => null),
    isClosed: vi.fn(() => false),
    locator: vi.fn(() => bodyLocator),
    setViewportSize: vi.fn(async () => undefined),
    title: vi.fn(async () => (location.current === "about:blank" ? "" : location.current)),
    url: () => location.current,
  };
  return { ariaSnapshot, fill, filter, focus, getByRole, location, page, events, frame };
}

type FakePage = ReturnType<typeof fakePage>["page"];
type FakeDialog = Pick<Dialog, "type" | "accept" | "dismiss">;

function fakeContext(pages: FakePage[]) {
  const events = new EventEmitter<{ page: [FakePage]; dialog: [FakeDialog] }>();
  const cdpMethods: string[] = [];
  const detach = vi.fn(async () => undefined);
  const capture = vi.fn(async (_page: FakePage, _params: unknown) => ({
    data: pngHeader().toString("base64"),
  }));
  const context = {
    newCDPSession: vi.fn(async (page: FakePage) => ({
      detach,
      send: vi.fn(async (method: string, params?: unknown) => {
        cdpMethods.push(method);
        switch (method) {
          case "Target.getTargetInfo":
            return { targetInfo: { targetId: page.targetId } };
          case "Page.getFrameTree":
            return { frameTree: { frame: { id: "frame-1", loaderId: page.loaderId } } };
          case "Page.getLayoutMetrics":
            return { cssVisualViewport: { ...page.viewport } };
          case "Page.captureScreenshot":
            return await capture(page, params);
          default:
            throw new Error(`Unexpected CDP method: ${method}`);
        }
      }),
    })),
    on: events.on.bind(events),
    pages: () => pages,
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  return {
    cdpMethods,
    capture,
    context,
    detach,
    events,
    openPage: (page: FakePage) => {
      pages.push(page);
      events.emit("page", page);
    },
  };
}

function connectFakeContext(context: ReturnType<typeof fakeContext>["context"]) {
  const close = vi.fn(async () => undefined);
  // @ts-expect-error This behavior test supplies only the Playwright methods the adapter exercises.
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({ contexts: () => [context], close });
  return close;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trusted Playwright observer", () => {
  test("captures the exact selected target at 2x using scrolled CSS viewport coordinates", async () => {
    const first = fakePage("https://example.com/?private=yes#details", "first", true, "first");
    const second = fakePage("https://example.com/?private=yes#details", "second", true, "second");
    const pages = [first.page, second.page];
    const { context, capture, detach } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    await browser.selectTab("first");
    pages.reverse();
    first.page.setViewportSize.mockClear();
    second.page.setViewportSize.mockClear();
    detach.mockClear();

    const result = await browser.captureScreenshot("first");

    expect(capture).toHaveBeenCalledExactlyOnceWith(first.page, {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 125, y: 600, width: 1280, height: 800, scale: 2 },
    });
    expect(result.bytes).toEqual(pngHeader());
    expect(result.metadata).toEqual({
      tabId: "first",
      url: "https://example.com/",
      title: first.location.current,
      startedAtMs: expect.any(Number),
      completedAtMs: expect.any(Number),
      width: 2560,
      height: 1600,
      viewport: { width: 1280, height: 800, scrollX: 125, scrollY: 600 },
    });
    expect(result.metadata.completedAtMs).toBeGreaterThanOrEqual(result.metadata.startedAtMs);
    expect(first.page.setViewportSize).not.toHaveBeenCalled();
    expect(second.page.setViewportSize).not.toHaveBeenCalled();
    expect(first.page.bringToFront).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledOnce();
    expect(first.events.listenerCount("framenavigated")).toBe(0);
    expect(await browser.selectedTabId()).toBe("first");
  });

  test("rejects closed or mismatched targets without falling back to another page", async () => {
    const first = fakePage("https://example.com/", "first", true, "first");
    const second = fakePage("https://example.com/", "second", true, "second");
    const { context, capture } = fakeContext([first.page, second.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    await browser.selectTab("first");
    await expect(browser.captureScreenshot("second")).rejects.toThrow("does not match");
    first.page.isClosed.mockReturnValue(true);
    await expect(browser.captureScreenshot("first")).rejects.toThrow("target is closed");
    expect(capture).not.toHaveBeenCalled();
    expect(second.page.bringToFront).not.toHaveBeenCalled();
  });

  test.each(["navigation", "reload", "scroll", "resize", "title", "target", "popup", "closed"])(
    "rejects a %s change during capture and releases the CDP session",
    async (change) => {
      const initial = fakePage("https://example.com/", "initial", true, "first");
      const { context, capture, detach, openPage } = fakeContext([initial.page]);
      connectFakeContext(context);
      const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
      capture.mockImplementationOnce(async () => {
        switch (change) {
          case "navigation":
            initial.location.current = "https://example.com/other";
            break;
          case "reload":
            initial.events.emit("framenavigated", initial.frame);
            break;
          case "scroll":
            initial.page.viewport.pageY += 1;
            break;
          case "resize":
            initial.page.viewport.clientWidth += 1;
            break;
          case "title":
            initial.page.title.mockResolvedValue("Changed title");
            break;
          case "target":
            initial.page.targetId = "different-target";
            break;
          case "popup":
            openPage(fakePage("https://example.com/", "popup").page);
            break;
          case "closed":
            initial.page.isClosed.mockReturnValue(true);
            break;
        }
        return { data: pngHeader().toString("base64") };
      });

      await expect(browser.captureScreenshot("first")).rejects.toThrow(/Screenshot target/);

      expect(capture).toHaveBeenCalledOnce();
      expect(detach).toHaveBeenCalledOnce();
      expect(initial.events.listenerCount("framenavigated")).toBe(0);
    },
  );

  test("rejects reloads detected by loader identity even if the navigation event has not arrived", async () => {
    const initial = fakePage("https://example.com/", "initial", true, "first");
    const { context, capture } = fakeContext([initial.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    capture.mockImplementationOnce(async () => {
      initial.page.loaderId = "loader-2";
      return { data: pngHeader().toString("base64") };
    });
    await expect(browser.captureScreenshot("first")).rejects.toThrow("changed during capture");
  });

  test.each([
    { data: "not a png", message: "not a PNG" },
    { data: pngHeader(1280, 800).toString("base64"), message: "2x viewport" },
    {
      data: pngHeader(2560, 1600, MAX_SCREENSHOT_BYTES + 1).toString("base64"),
      message: "byte limit",
    },
    { data: "A".repeat(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4), message: "byte limit" },
  ])("rejects invalid or oversized PNG output: $message", async ({ data, message }) => {
    const { context, capture, detach } = fakeContext([
      fakePage("https://example.com/", "page", true, "first").page,
    ]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    capture.mockResolvedValueOnce({ data });
    await expect(browser.captureScreenshot("first")).rejects.toThrow(message);
    expect(detach).toHaveBeenCalledOnce();
  });

  test("accepts the exact byte limit and aborts an in-flight capture without another attempt", async () => {
    const initial = fakePage("https://example.com/", "page", true, "first");
    const { context, capture, detach } = fakeContext([initial.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    capture.mockResolvedValueOnce({
      data: pngHeader(2560, 1600, MAX_SCREENSHOT_BYTES).toString("base64"),
    });
    expect((await browser.captureScreenshot("first")).bytes.length).toBe(MAX_SCREENSHOT_BYTES);

    const controller = new AbortController();
    capture.mockImplementationOnce(async () => {
      controller.abort(new Error("Capture canceled"));
      return await new Promise<never>(() => {});
    });
    await expect(browser.captureScreenshot("first", controller.signal)).rejects.toThrow(
      "Capture canceled",
    );
    await setImmediate();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(detach).toHaveBeenCalledTimes(2);
    expect(initial.events.listenerCount("framenavigated")).toBe(0);
  });

  test.skipIf(process.env["SCOUT_RUN_BROWSER_PROOF"] !== "true")(
    "captures native 2x scrolled pixels while preserving viewport, focus, and form state",
    async () => {
      const nativeBrowser = await chromium.launch(
        omitNullish({
          executablePath: process.env["SCOUT_BROWSER_PROOF_CHROMIUM"],
          headless: true,
        }),
      );
      try {
        const context = await nativeBrowser.newContext();
        const page = await context.newPage();
        await page.route(
          "https://example.com/capture",
          async (route) =>
            await route.fulfill({
              contentType: "text/html",
              body: `
          <title>Capture proof</title>
          <body style="margin:0;background:red;width:3000px;height:2400px">
            <div style="position:absolute;top:600px;width:3000px;height:1800px;background:blue"></div>
            <input style="position:fixed;left:100px;top:100px" value="Preserved draft">
            <div style="position:fixed;left:0;top:0;width:30px;height:30px;background:yellow"></div>
          </body>
        `,
            }),
        );
        await page.goto("https://example.com/capture");
        vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(nativeBrowser);
        const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
        const selectedId = await browser.selectedTabId();
        if (!selectedId) throw new Error("Expected a selected tab");
        await page.locator("input").focus();
        await page.evaluate(() => window.scrollTo(200, 650));
        const state = () =>
          page.evaluate(() => ({
            x: scrollX,
            y: scrollY,
            width: innerWidth,
            height: innerHeight,
            focused: document.activeElement?.tagName,
            value: document.querySelector("input")?.value,
          }));
        const before = await state();
        const screenshot = await browser.captureScreenshot(selectedId);
        expect(await state()).toEqual(before);
        expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
        expect(screenshot.metadata).toMatchObject({
          tabId: selectedId,
          title: "Capture proof",
          width: 2560,
          height: 1600,
          viewport: { width: 1280, height: 800, scrollX: 200, scrollY: 650 },
        });
        const pixels = await page.evaluate(
          async (data) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(data)], { type: "image/png" }),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas context missing");
            ctx.drawImage(bitmap, 0, 0);
            return {
              width: bitmap.width,
              height: bitmap.height,
              fixed: [...ctx.getImageData(10, 10, 1, 1).data],
              scrolled: [...ctx.getImageData(1000, 1000, 1, 1).data],
            };
          },
          [...screenshot.bytes],
        );
        expect(pixels).toEqual({
          width: 2560,
          height: 1600,
          fixed: [255, 255, 0, 255],
          scrolled: [0, 0, 255, 255],
        });
        const other = await context.newPage();
        await other.setContent("<h1>Another tab</h1>");
        await browser.selectTab(selectedId);
        await page.close();
        await expect(browser.captureScreenshot(selectedId)).rejects.toThrow("target is closed");
      } finally {
        await nativeBrowser.close();
      }
    },
    30_000,
  );

  test("disconnect releases the CDP connection", async () => {
    const { context } = fakeContext([fakePage("https://example.com", "Example").page]);
    const close = connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    await browser.disconnect();

    expect(close).toHaveBeenCalledOnce();
  });

  test.each(["alert", "confirm", "prompt", "beforeunload"])(
    "preserves default dialog handling for %s, including new tabs",
    async (type) => {
      const { context, events, openPage } = fakeContext([
        fakePage("https://example.com", "Example").page,
      ]);
      connectFakeContext(context);
      const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
      openPage(fakePage("https://example.com/popup", "Popup").page);
      const dialog = {
        type: () => type,
        accept: vi.fn(async () => undefined),
        dismiss: vi.fn(async () => undefined),
      } satisfies FakeDialog;

      events.emit("dialog", dialog);
      await expect(browser.snapshot()).resolves.toBe("Popup");

      expect(dialog.accept).toHaveBeenCalledTimes(type === "beforeunload" ? 1 : 0);
      expect(dialog.dismiss).toHaveBeenCalledTimes(type === "beforeunload" ? 0 : 1);
      expect(events.listenerCount("dialog")).toBe(1);
    },
  );

  test.each([
    { type: "beforeunload", prefix: "" },
    { type: "beforeunload", prefix: "dialog.accept: " },
    { type: "alert", prefix: "" },
    { type: "alert", prefix: "dialog.dismiss: " },
  ])("handles the exact already-closed dialog race: $type / $prefix", async ({ type, prefix }) => {
    const { context, events } = fakeContext([fakePage("https://example.com", "Example").page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    const failure = new Error(
      `${prefix}Protocol error (Page.handleJavaScriptDialog): No dialog is showing`,
    );
    const handle = vi.fn(async () => {
      throw failure;
    });

    events.emit("dialog", { type: () => type, accept: handle, dismiss: handle });
    // Let Node check for unhandled rejections before an operation joins the handler.
    await setImmediate();

    await expect(browser.observe()).resolves.toMatchObject({ tabs: [expect.any(Object)] });
    await expect(browser.disconnect()).resolves.toBeUndefined();
    expect(handle).toHaveBeenCalledOnce();
  });

  test.each([
    new Error("Protocol error (Page.handleJavaScriptDialog): Permission denied"),
    new Error("Protocol error (Page.handleJavaScriptDialog): No dialog is showing (other error)"),
    new Error("dialog.dismiss: Target page, context or browser has been closed"),
    "Protocol error (Page.handleJavaScriptDialog): No dialog is showing",
    undefined,
  ])("surfaces unexpected dialog rejection unchanged: %s", async (failure) => {
    const { context, events } = fakeContext([fakePage("https://example.com", "Example").page]);
    const close = connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    events.emit("dialog", {
      type: () => "alert",
      accept: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => {
        throw failure;
      }),
    });
    await setImmediate();

    await expect(browser.observe()).rejects.toBe(failure);
    await expect(browser.snapshot()).rejects.toBe(failure);
    await expect(browser.disconnect()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  test("joins a pending dialog failure raised during navigation", async () => {
    const initial = fakePage("https://example.com", "Example");
    const { context, events } = fakeContext([initial.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    const failure = new Error("Dialog response failed");
    initial.page.goto.mockImplementation(async () => {
      events.emit("dialog", {
        type: () => "beforeunload",
        accept: async () => {
          await setImmediate();
          throw failure;
        },
        dismiss: vi.fn(async () => undefined),
      });
      return null;
    });

    await expect(browser.navigate("https://example.com/next")).rejects.toBe(failure);
  });

  test("keeps concurrent dialog failures even when the latest handler succeeds", async () => {
    const { context, events } = fakeContext([fakePage("https://example.com", "Example").page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    const failure = new Error("First dialog failed");
    events.emit("dialog", {
      type: () => "alert",
      accept: vi.fn(async () => undefined),
      dismiss: async () => {
        await setImmediate();
        throw failure;
      },
    });
    events.emit("dialog", {
      type: () => "alert",
      accept: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
    });

    await expect(browser.observe()).rejects.toBe(failure);
  });

  test("retains the handler through disconnect and reports late failures after closing", async () => {
    const { context, events } = fakeContext([fakePage("https://example.com", "Example").page]);
    const close = connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    const failure = new Error("Dialog failed during disconnect");
    close.mockImplementation(async () => {
      expect(events.listenerCount("dialog")).toBe(1);
      events.emit("dialog", {
        type: () => "alert",
        accept: vi.fn(async () => undefined),
        dismiss: vi.fn(async () => {
          throw failure;
        }),
      });
    });

    await expect(browser.disconnect()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  test.skipIf(process.env["SCOUT_RUN_BROWSER_PROOF"] !== "true")(
    "fills unlabeled password inputs without selecting hidden or ambiguous fields",
    async () => {
      const nativeBrowser = await chromium.launch(
        omitNullish({
          executablePath: process.env["SCOUT_BROWSER_PROOF_CHROMIUM"],
          headless: true,
        }),
      );
      try {
        const context = await nativeBrowser.newContext();
        const page = await context.newPage();
        await page.setContent(`
          <input type="password" name="password" hidden>
          <input type="password" name="password">
          <input type="password" name="confirmation">
        `);
        vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(nativeBrowser);
        const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
        const target = browserTargetSchema.parse({
          kind: "css",
          selector: 'input[name="password"]',
        });

        await expect(browser.getElementAttribute(target, "type")).resolves.toBe("password");
        await browser.fill(target, "test-password");

        expect(await page.locator("input[hidden]").inputValue()).toBe("");
        expect(await page.locator('input[name="password"]:visible').inputValue()).toBe(
          "test-password",
        );
        const ambiguous = browserTargetSchema.parse({
          kind: "css",
          selector: 'input[type="password"]',
        });
        await expect(browser.getElementAttribute(ambiguous, "type")).rejects.toThrow(
          "strict mode violation",
        );
        await expect(browser.fill(ambiguous, "wrong-password")).rejects.toThrow(
          "strict mode violation",
        );
        expect(await page.locator('input[name="confirmation"]').inputValue()).toBe("");
        expect(await page.locator('input[name="password"]:visible').inputValue()).toBe(
          "test-password",
        );
      } finally {
        await nativeBrowser.close();
      }
    },
  );

  test.skipIf(process.env["SCOUT_RUN_BROWSER_PROOF"] !== "true")(
    "preserves native iframe snapshots and semantic targets without internal references",
    async () => {
      const nativeBrowser = await chromium.launch(
        omitNullish({
          executablePath: process.env["SCOUT_BROWSER_PROOF_CHROMIUM"],
          headless: true,
        }),
      );
      try {
        const context = await nativeBrowser.newContext();
        const page = await context.newPage();
        await page.setContent(`
          <h1>Guide [ref=e99]</h1>
          <button disabled>Save "report"</button>
          <button>Save: now</button>
          <button>John's #1</button>
          <button>/settings/</button>
          <button>Save [ref=e99] [draft</button>
          <p>Keep [ref=e88] in the document</p>
          <iframe title="Editor" srcdoc='<label>Content<input value="Draft"></label>'></iframe>
        `);
        await page.frameLocator("iframe").getByRole("textbox", { name: "Content" }).fill("Revised");
        vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(nativeBrowser);
        const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

        const snapshot = await browser.snapshot();
        expect(snapshot).toContain('heading "Guide [ref=e99]" [level=1]');
        expect(snapshot).toContain("[disabled]");
        expect(snapshot).toContain(`- 'button "Save: now"'`);
        expect(snapshot).toContain(`- 'button "John''s #1"'`);
        expect(snapshot).toContain("- button /settings/");
        expect(snapshot).toContain('button "Save [ref=e99] [draft"');
        expect(snapshot).toContain('textbox "Content" [active]: Revised');
        expect(snapshot).toContain("Keep [ref=e88] in the document");
        expect(snapshot.match(/\[ref=[^\]]+\]/g)).toEqual(["[ref=e99]", "[ref=e99]", "[ref=e88]"]);
      } finally {
        await nativeBrowser.close();
      }
    },
  );

  test("stops waiting for an in-flight CDP connection when aborted", async () => {
    const controller = new AbortController();
    const connect = vi.spyOn(chromium, "connectOverCDP");
    connect.mockImplementation(async () => await new Promise<never>(() => {}));

    const connection = connectPlaywrightBrowser(
      "wss://browser.firecrawl.dev/cdp",
      controller.signal,
    );
    controller.abort(new Error("Scout slice expired"));

    await expect(connection).rejects.toThrow("Scout slice expired");
  });

  test("captures AI snapshots and reads visible semantic targets", async () => {
    const initial = fakePage("https://samebase.com/", '- link "Go to dashboard" [ref=e1]');
    const pages = [initial.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);

    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    const target = { kind: "role", role: "textbox", name: "Password", exact: true } as const;

    await expect(browser.snapshot()).resolves.toContain("Go to dashboard");
    await expect(browser.getElementAttribute(target, "type")).resolves.toBe("password");
    await browser.fill(target, "secret");

    expect(initial.ariaSnapshot).toHaveBeenCalledWith({
      mode: "ai",
      timeout: 30_000,
    });
    expect(initial.getByRole).toHaveBeenCalledWith("textbox", {
      name: "Password",
      exact: true,
    });
    expect(initial.filter).toHaveBeenCalledWith({ visible: true });
    expect(initial.fill).toHaveBeenCalledWith("secret", {});
  });

  test("removes snapshot references while preserving iframe controls, states, and literal text", async () => {
    const initial = fakePage(
      "https://example.com/",
      `- heading "Guide [ref=e99]" [level=1] [ref=e1]
- button "Save \\"report\\"" [disabled] [ref=e2]
- iframe "Editor" [ref=e3]:
  - textbox "Content" [ref=f1e1]: Draft
- text: Keep [ref=e88] in the document
- link "Documentation" [ref=e4] [cursor=pointer]:
  - /url: https://example.com/[ref=e77]`,
    );
    const { context } = fakeContext([initial.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    await expect(browser.snapshot()).resolves.toBe(`- heading "Guide [ref=e99]" [level=1]
- button "Save \\"report\\"" [disabled]
- iframe "Editor":
  - textbox "Content": Draft
- text: Keep [ref=e88] in the document
- link "Documentation" [cursor=pointer]:
  - /url: https://example.com/[ref=e77]`);
  });

  test("preserves YAML-quoted and slash-delimited names, including literal reference text", async () => {
    const initial = fakePage(
      "https://example.com/",
      `- 'button "Save: now [ref=e99]" [ref=e1] [cursor=pointer]'
- 'button "John''s #1" [ref=e2]'
- button /settings/ [ref=e3]
- textbox /path/ [ref=e4]: /caption/ [ref=e88]
- button "John's report" [ref=e5]
- button "Save [ref=e99] [draft" [ref=e6]`,
    );
    const { context } = fakeContext([initial.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    await expect(browser.snapshot()).resolves
      .toBe(`- 'button "Save: now [ref=e99]" [cursor=pointer]'
- 'button "John''s #1"'
- button /settings/
- textbox /path/: /caption/ [ref=e88]
- button "John's report"
- button "Save [ref=e99] [draft"`);
  });

  test("keeps stable tab IDs and treats a newly opened page as active", async () => {
    const initial = fakePage("https://samebase.com/", "initial");
    const popup = fakePage("https://dashboard.convex.dev/", "popup");
    const pages = [initial.page];
    const { context, openPage } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    openPage(popup.page);

    await expect(browser.observe()).resolves.toEqual({
      capturedAtMs: expect.any(Number),
      tabs: [
        expect.objectContaining({ active: false, tabId: "target:https://samebase.com/" }),
        expect.objectContaining({
          active: true,
          tabId: "target:https://dashboard.convex.dev/",
        }),
      ],
    });
  });

  test("stops waiting for an in-flight Playwright control call when aborted", async () => {
    const initial = fakePage("https://samebase.com/", "initial", true);
    const pages = [initial.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    initial.page.title.mockImplementation(async () => await new Promise<never>(() => {}));
    const controller = new AbortController();

    const observation = browser.observe(controller.signal);
    controller.abort(new Error("Scout slice expired"));

    await expect(observation).rejects.toThrow("Scout slice expired");
  });

  test("keeps the same tab ID when a page navigates or reloads", async () => {
    const cloudflare = fakePage("https://dash.cloudflare.com/", "dashboard", true);
    const pages = [cloudflare.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    const before = await browser.observe();
    cloudflare.location.current = "https://github.com/login/oauth/authorize";
    const after = await browser.observe();

    expect(before.tabs).toEqual([
      expect.objectContaining({
        tabId: "target:https://dash.cloudflare.com/",
        url: "https://dash.cloudflare.com/",
      }),
    ]);
    expect(after.tabs).toEqual([
      expect.objectContaining({
        tabId: "target:https://dash.cloudflare.com/",
        url: "https://github.com/login/oauth/authorize",
      }),
    ]);
    expect(context.newCDPSession).toHaveBeenCalledOnce();
  });

  test("uses the selected target when both tabs report focus and their order changes", async () => {
    const initial = fakePage("https://samebase.com/", "initial", true);
    const dashboard = fakePage("https://dashboard.convex.dev/", "dashboard", true);
    const pages = [initial.page, dashboard.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    await browser.selectTab("target:https://samebase.com/");
    pages.reverse();
    await expect(browser.snapshot()).resolves.toBe("initial");
    await browser.selectTab("target:https://dashboard.convex.dev/");

    await expect(browser.observe()).resolves.toEqual({
      capturedAtMs: expect.any(Number),
      tabs: [
        expect.objectContaining({ active: true, title: "https://dashboard.convex.dev/" }),
        expect.objectContaining({ active: false, title: "https://samebase.com/" }),
      ],
    });
    await expect(browser.snapshot()).resolves.toBe("dashboard");
  });

  test("reports about:blank explicitly instead of conflating it with an unavailable URL", async () => {
    const blank = fakePage("about:blank", "blank", true);
    const pages = [blank.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);

    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    await expect(browser.observe()).resolves.toEqual({
      capturedAtMs: expect.any(Number),
      tabs: [{ active: true, tabId: "target:about:blank", title: "", url: "about:blank" }],
    });
  });

  test("distinguishes tabs with identical URLs and titles and rejects a missing target", async () => {
    const first = fakePage("https://example.com/", "first tab", true, "first");
    const second = fakePage("https://example.com/", "second tab", true, "second");
    const { context } = fakeContext([first.page, second.page]);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");
    await expect(browser.selectTab("first")).resolves.toBe(true);
    await expect(browser.snapshot()).resolves.toBe("first tab");
    await expect(browser.selectTab("closed-target")).resolves.toBe(false);
    await expect(browser.selectedTabId()).resolves.toBe("first");
  });

  test("keeps CDP target IDs stable when reconnecting with pages in a different order", async () => {
    const firstConnection = fakeContext([
      fakePage("https://samebase.com/", "samebase", true, "target-1").page,
      fakePage("https://dash.cloudflare.com/", "cloudflare", false, "target-2").page,
    ]);
    const secondConnection = fakeContext([
      fakePage("https://dash.cloudflare.com/", "cloudflare", false, "target-2").page,
      fakePage("https://samebase.com/", "samebase", true, "target-1").page,
    ]);
    const connect = vi.spyOn(chromium, "connectOverCDP");
    // @ts-expect-error This behavior test supplies only the Playwright methods the adapter exercises.
    connect.mockResolvedValueOnce({ contexts: () => [firstConnection.context] });
    // @ts-expect-error This behavior test supplies only the Playwright methods the adapter exercises.
    connect.mockResolvedValueOnce({ contexts: () => [secondConnection.context] });

    const before = await (
      await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp")
    ).observe();
    const after = await (
      await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp")
    ).observe();

    expect(Object.fromEntries(before.tabs.map((tab) => [tab.url, tab.tabId]))).toEqual({
      "https://samebase.com/": "target-1",
      "https://dash.cloudflare.com/": "target-2",
    });
    expect(Object.fromEntries(after.tabs.map((tab) => [tab.url, tab.tabId]))).toEqual({
      "https://samebase.com/": "target-1",
      "https://dash.cloudflare.com/": "target-2",
    });
    expect(firstConnection.cdpMethods).toEqual(["Target.getTargetInfo", "Target.getTargetInfo"]);
    expect(secondConnection.cdpMethods).toEqual(["Target.getTargetInfo", "Target.getTargetInfo"]);
    expect(firstConnection.detach).toHaveBeenCalledTimes(2);
    expect(secondConnection.detach).toHaveBeenCalledTimes(2);
  });
});
