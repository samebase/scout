import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { connectPlaywrightBrowser } from "./playwrightBrowser";

function fakePage(url: string, snapshot: string, initiallyFocused = false) {
  const focus = { current: initiallyFocused };
  const fill = vi.fn(async () => undefined);
  const filter = vi.fn();
  const first = vi.fn();
  const semanticLocator = {
    fill,
    filter,
    first,
    getAttribute: vi.fn(async () => "password"),
    innerText: vi.fn(async () => "Conrad"),
  } as unknown as Locator;
  filter.mockReturnValue(semanticLocator);
  first.mockReturnValue(semanticLocator);
  const ariaSnapshot = vi.fn(async () => snapshot);
  const bodyLocator = {
    ariaSnapshot,
  } as unknown as Locator;
  const getByRole = vi.fn(() => semanticLocator);
  const page = {
    evaluate: vi.fn(async () => focus.current),
    getByRole,
    goto: vi.fn(async () => null),
    isClosed: () => false,
    locator: vi.fn(() => bodyLocator),
    setViewportSize: vi.fn(async () => undefined),
    title: vi.fn(async () => url),
    url: () => url,
  } as unknown as Page;
  return { ariaSnapshot, fill, filter, focus, getByRole, page };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trusted Playwright observer", () => {
  test("captures AI snapshots and reads visible semantic targets", async () => {
    const initial = fakePage("https://samebase.com/", '- link "Go to dashboard" [ref=e1]');
    const pages = [initial.page];
    const context = {
      on: vi.fn(),
      pages: () => pages,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
    } as unknown as BrowserContext;
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
      contexts: () => [context],
    } as never);

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
    let pageListener: ((page: Page) => void) | undefined;
    const context = {
      on: vi.fn((event: string, listener: (page: Page) => void) => {
        if (event === "page") pageListener = listener;
      }),
      pages: () => pages,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
    } as unknown as BrowserContext;
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
      contexts: () => [context],
    } as never);
    const browser = await connectPlaywrightBrowser("wss://browser.firecrawl.dev/cdp");

    pages.push(popup.page);
    pageListener?.(popup.page);

    await expect(browser.observe()).resolves.toEqual({
      capturedAtMs: expect.any(Number),
      tabs: [
        expect.objectContaining({ active: false, tabId: "t1" }),
        expect.objectContaining({ active: true, tabId: "t2" }),
      ],
    });
  });

  test("follows the focused page when existing tabs change places", async () => {
    const initial = fakePage("https://samebase.com/", "initial", true);
    const dashboard = fakePage("https://dashboard.convex.dev/", "dashboard");
    const pages = [initial.page, dashboard.page];
    const context = {
      on: vi.fn(),
      pages: () => pages,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
    } as unknown as BrowserContext;
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
      contexts: () => [context],
    } as never);
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
});
