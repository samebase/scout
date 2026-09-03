import { chromium } from "playwright-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { connectPlaywrightBrowser } from "./playwrightBrowser";

function fakePage(url: string, snapshot: string, initiallyFocused = false) {
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
  const context = {
    on: vi.fn((event: string, listener: (page: FakePage) => void) => {
      if (event === "page") pageListener = listener;
    }),
    pages: () => pages,
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  return {
    context,
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
    expect(initial.fill).toHaveBeenCalledWith("secret");
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
        expect.objectContaining({ active: false, tabId: "t1" }),
        expect.objectContaining({ active: true, tabId: "t2" }),
      ],
    });
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
      expect.objectContaining({ tabId: "t1", url: "https://dash.cloudflare.com/" }),
    ]);
    expect(after.tabs).toEqual([
      expect.objectContaining({ tabId: "t1", url: "https://github.com/login/oauth/authorize" }),
    ]);
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
      tabs: [{ active: true, tabId: "t1", title: "", url: "about:blank" }],
    });
  });
});
