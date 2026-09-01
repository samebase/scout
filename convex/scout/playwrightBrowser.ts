"use node";

import { type Infer } from "convex/values";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { taskBrowserTelemetryValidator } from "../taskBrowserModel";
import { type BrowserTarget } from "./browserTarget";

const BROWSER_ACTION_TIMEOUT_MS = 60_000;
const SNAPSHOT_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 } as const;

type PlaywrightRole = Parameters<Page["getByRole"]>[0];

export type TaskBrowserTelemetry = Infer<typeof taskBrowserTelemetryValidator>;
export type BrowserObservation = TaskBrowserTelemetry["before"];

export type PlaywrightBrowser = {
  snapshot: () => Promise<string>;
  navigate: (url: string) => Promise<void>;
  getPage: (kind: "url" | "title") => Promise<string>;
  getElement: (target: BrowserTarget) => Promise<string>;
  getElementAttribute: (target: BrowserTarget, attribute: "type") => Promise<string>;
  fill: (target: BrowserTarget, text: string) => Promise<void>;
  observe: () => Promise<BrowserObservation>;
};

function displayUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function requireCdpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "wss:") {
    throw new Error("Firecrawl returned an invalid browser CDP URL");
  }
  return url.toString();
}

class ConnectedPlaywrightBrowser implements PlaywrightBrowser {
  private readonly context: BrowserContext;
  private activePage: Page;
  private nextTabNumber = 1;
  private readonly tabIds = new Map<Page, string>();

  constructor(context: BrowserContext) {
    this.context = context;
    context.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(BROWSER_ACTION_TIMEOUT_MS);
    const pages = context.pages();
    const initialPage =
      [...pages].reverse().find((page) => page.url() !== "about:blank") ?? pages[0];
    if (!initialPage) {
      throw new Error("Firecrawl browser session has no page");
    }
    this.activePage = initialPage;
    this.tabId(initialPage);
    context.on("page", (page) => {
      this.activePage = page;
      this.tabId(page);
      void page.setViewportSize(VIEWPORT).catch(() => undefined);
    });
  }

  async initialize() {
    await this.activePage.setViewportSize(VIEWPORT);
  }

  private tabId(page: Page) {
    const existing = this.tabIds.get(page);
    if (existing) return existing;
    const tabId = `t${this.nextTabNumber}`;
    this.nextTabNumber += 1;
    this.tabIds.set(page, tabId);
    return tabId;
  }

  private page() {
    if (!this.activePage.isClosed()) return this.activePage;
    const active = this.context
      .pages()
      .filter((page) => !page.isClosed())
      .at(-1);
    if (!active) throw new Error("The browser has no open tab");
    this.activePage = active;
    return active;
  }

  private locator(target: BrowserTarget): Locator {
    const page = this.page();
    switch (target.kind) {
      case "role":
        return page
          .getByRole(target.role as PlaywrightRole, {
            name: target.name,
            exact: target.exact,
          })
          .filter({ visible: true })
          .first();
      case "label":
        return page
          .getByLabel(target.text, { exact: target.exact })
          .filter({ visible: true })
          .first();
      case "text":
        return page
          .getByText(target.text, { exact: target.exact })
          .filter({ visible: true })
          .first();
    }
  }

  async snapshot() {
    return await this.page().locator("body").ariaSnapshot({
      mode: "ai",
      timeout: SNAPSHOT_TIMEOUT_MS,
    });
  }

  async navigate(url: string) {
    await this.page().goto(url, { waitUntil: "domcontentloaded" });
  }

  async getPage(kind: "url" | "title") {
    return kind === "url" ? this.page().url() : await this.page().title();
  }

  async getElement(target: BrowserTarget) {
    return await this.locator(target).innerText();
  }

  async getElementAttribute(target: BrowserTarget, attribute: "type") {
    return (await this.locator(target).getAttribute(attribute)) ?? "";
  }

  async fill(target: BrowserTarget, text: string) {
    await this.locator(target).fill(text);
  }

  async observe() {
    const pages = this.context.pages().filter((page) => !page.isClosed());
    if (pages.length === 0) throw new Error("The browser has no open tab");
    if (this.activePage.isClosed()) this.activePage = pages.at(-1) ?? pages[0];
    return {
      capturedAtMs: Date.now(),
      tabs: await Promise.all(
        pages.map(async (page) => ({
          tabId: this.tabId(page),
          title: await page.title().catch(() => ""),
          url: displayUrl(page.url()),
          active: page === this.activePage,
        })),
      ),
    };
  }
}

export async function connectPlaywrightBrowser(cdpUrl: string): Promise<PlaywrightBrowser> {
  const browser = await chromium.connectOverCDP(requireCdpUrl(cdpUrl));
  const context = browser.contexts()[0];
  if (!context) throw new Error("Firecrawl browser session has no browser context");
  const connected = new ConnectedPlaywrightBrowser(context);
  await connected.initialize();
  return connected;
}
