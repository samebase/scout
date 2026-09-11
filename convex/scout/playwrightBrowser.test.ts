import { chromium } from "playwright-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { omitNullish } from "../../shared/omitNullish";
import { browserTargetSchema } from "./browserTarget";
import { connectPlaywrightBrowser } from "./playwrightBrowser";

function fakePage(
  url: string,
  snapshot: string,
  initiallyFocused = false,
  targetId = `target:${url}`,
) {
  const focus = { current: initiallyFocused };
  const location = { current: url };
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
    bringToFront: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => focus.current),
    getByRole,
    goto: vi.fn(async () => null),
    isClosed: () => false,
    locator: vi.fn(() => bodyLocator),
    setViewportSize: vi.fn(async () => undefined),
    title: vi.fn(async () => (location.current === "about:blank" ? "" : location.current)),
    url: () => location.current,
  };
  return { ariaSnapshot, fill, filter, focus, getByRole, location, page };
}

type FakePage = ReturnType<typeof fakePage>["page"];

function fakeContext(pages: FakePage[]) {
  let pageListener: ((page: FakePage) => void) | undefined;
  const cdpMethods: string[] = [];
  const detach = vi.fn(async () => undefined);
  const context = {
    newCDPSession: vi.fn(async (page: FakePage) => ({
      detach,
      send: vi.fn(async (method: string) => {
        cdpMethods.push(method);
        return { targetInfo: { targetId: page.targetId } };
      }),
    })),
    on: vi.fn((event: string, listener: (page: FakePage) => void) => {
      if (event === "page") pageListener = listener;
    }),
    pages: () => pages,
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  return {
    cdpMethods,
    context,
    detach,
    openPage: (page: FakePage) => {
      pages.push(page);
      pageListener?.(page);
    },
  };
}

function connectFakeContext(context: ReturnType<typeof fakeContext>["context"]) {
  // @ts-expect-error This behavior test supplies only the Playwright methods the adapter exercises.
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({ contexts: () => [context] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trusted Playwright observer", () => {
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
