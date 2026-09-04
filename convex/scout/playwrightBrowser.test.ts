import { chromium } from "playwright-core";
import { afterEach, describe, expect, test, vi } from "vitest";
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
    initial.page.evaluate.mockImplementation(async () => await new Promise<never>(() => {}));
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

  test("follows the focused page when existing tabs change places", async () => {
    const initial = fakePage("https://samebase.com/", "initial", true);
    const dashboard = fakePage("https://dashboard.convex.dev/", "dashboard");
    const pages = [initial.page, dashboard.page];
    const { context } = fakeContext(pages);
    connectFakeContext(context);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    initial.focus.current = false;
    dashboard.focus.current = true;

    await expect(browser.observe()).resolves.toEqual({
      capturedAtMs: expect.any(Number),
      tabs: [
        expect.objectContaining({ active: false, title: "https://samebase.com/" }),
        expect.objectContaining({ active: true, title: "https://dashboard.convex.dev/" }),
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
