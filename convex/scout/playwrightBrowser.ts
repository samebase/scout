"use node";

import { type Infer } from "convex/values";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { omitNullish } from "../../shared/omitNullish";
import { browserTelemetryValidator } from "../browserModel";
import { type BrowserTarget } from "./browserTarget";
import { BrowserClickRecorder, type BrowserClickCapture } from "./browserClickRecorder";
import { requireFirecrawlCdpUrl } from "./lib/firecrawlCdpUrl";

const BROWSER_ACTION_TIMEOUT_MS = 60_000;
const BROWSER_CONTROL_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 } as const;

export type BrowserTelemetry = Infer<typeof browserTelemetryValidator>;
export type BrowserObservation = BrowserTelemetry["before"];

export type PlaywrightBrowser = {
  startClickCapture: () => Promise<void>;
  finishClickCapture: () => Promise<BrowserClickCapture>;
  snapshot: (abortSignal?: AbortSignal) => Promise<string>;
  navigate: (url: string, abortSignal?: AbortSignal) => Promise<void>;
  getPage: (kind: "url" | "title", abortSignal?: AbortSignal) => Promise<string>;
  getElement: (target: BrowserTarget, abortSignal?: AbortSignal) => Promise<string>;
  getElementAttribute: (
    target: BrowserTarget,
    attribute: "type",
    abortSignal?: AbortSignal,
  ) => Promise<string>;
  fill: (target: BrowserTarget, text: string, abortSignal?: AbortSignal) => Promise<void>;
  observe: (abortSignal?: AbortSignal) => Promise<BrowserObservation>;
};

function runBoundedControlOperation<T>(operation: () => Promise<T>, abortSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(BROWSER_CONTROL_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    operation().then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function displayUrl(value: string) {
  if (value === "about:blank") return value;
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

class ConnectedPlaywrightBrowser implements PlaywrightBrowser {
  private readonly context: BrowserContext;
  private activePage: Page;
  private readonly tabIds = new Map<Page, Promise<string>>();
  private clickRecorder: BrowserClickRecorder | null = null;

  async startClickCapture() {
    this.clickRecorder = new BrowserClickRecorder(this.context);
    await this.clickRecorder.start();
  }

  async finishClickCapture(): Promise<BrowserClickCapture> {
    const recorder = this.clickRecorder;
    this.clickRecorder = null;
    return recorder ? await recorder.finish() : { kind: "unavailable" };
  }

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
    context.on("page", (page) => {
      this.activePage = page;
      void runBoundedControlOperation(async () => await page.setViewportSize(VIEWPORT)).catch(
        () => undefined,
      );
    });
  }

  async initialize(abortSignal?: AbortSignal) {
    await this.refreshActivePage(this.context.pages(), abortSignal);
    await runBoundedControlOperation(
      async () => await this.activePage.setViewportSize(VIEWPORT),
      abortSignal,
    );
  }

  private async refreshActivePage(pages: Page[], abortSignal?: AbortSignal) {
    abortSignal?.throwIfAborted();
    const focus = await Promise.all(
      pages.map(
        async (page) =>
          await runBoundedControlOperation(
            async () => await page.evaluate(() => document.hasFocus()),
            abortSignal,
          ).catch(() => false),
      ),
    );
    abortSignal?.throwIfAborted();
    const focusedIndex = focus.findLastIndex(Boolean);
    if (focusedIndex >= 0) {
      this.activePage = pages[focusedIndex] ?? this.activePage;
    }
  }

  private tabId(page: Page, abortSignal?: AbortSignal) {
    const existing = this.tabIds.get(page);
    if (existing) return existing;
    const tabId = runBoundedControlOperation(async () => {
      const session = await this.context.newCDPSession(page);
      try {
        return (await session.send("Target.getTargetInfo")).targetInfo.targetId;
      } finally {
        await session.detach().catch(() => undefined);
      }
    }, abortSignal);
    this.tabIds.set(page, tabId);
    void tabId.catch(() => this.tabIds.delete(page));
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
      case "css":
        return page.locator(`css=${target.selector}`).filter({ visible: true });
      case "role":
        return page
          .getByRole(target.role, {
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

  async snapshot(abortSignal?: AbortSignal) {
    const snapshot = await this.page()
      .locator("body")
      .ariaSnapshot(
        omitNullish({
          mode: "ai",
          timeout: SNAPSHOT_TIMEOUT_MS,
          signal: abortSignal,
        }),
      );
    // AI mode includes iframe contents. Match each YAML key (plain or single-quoted)
    // before removing its reference metadata, leaving names and text values intact.
    return snapshot.replace(
      /^[ \t]*- (?:'(?:[^'\n]|'')*'|[^'\n][^\n]*?)(?=:(?: |$)|$)/gm,
      (header) => header.replace(/ \[ref=[^[\]\s]+\](?=(?: \[[^[\]\n]*\])*'?$)/, ""),
    );
  }

  async navigate(url: string, abortSignal?: AbortSignal) {
    await this.page().goto(
      url,
      omitNullish({ waitUntil: "domcontentloaded", signal: abortSignal }),
    );
  }

  async getPage(kind: "url" | "title", abortSignal?: AbortSignal) {
    return kind === "url"
      ? this.page().url()
      : await runBoundedControlOperation(async () => await this.page().title(), abortSignal);
  }

  async getElement(target: BrowserTarget, abortSignal?: AbortSignal) {
    return await this.locator(target).innerText(omitNullish({ signal: abortSignal }));
  }

  async getElementAttribute(target: BrowserTarget, attribute: "type", abortSignal?: AbortSignal) {
    return (
      (await this.locator(target).getAttribute(attribute, omitNullish({ signal: abortSignal }))) ??
      ""
    );
  }

  async fill(target: BrowserTarget, text: string, abortSignal?: AbortSignal) {
    await this.locator(target).fill(text, omitNullish({ signal: abortSignal }));
  }

  async observe(abortSignal?: AbortSignal) {
    const pages = this.context.pages().filter((page) => !page.isClosed());
    if (pages.length === 0) throw new Error("The browser has no open tab");
    await this.refreshActivePage(pages, abortSignal);
    if (this.activePage.isClosed()) this.activePage = pages.at(-1) ?? pages[0];
    const tabs = await Promise.all(
      pages.map(async (page) => ({
        tabId: await this.tabId(page, abortSignal),
        title: await runBoundedControlOperation(async () => await page.title(), abortSignal).catch(
          () => "",
        ),
        url: displayUrl(page.url()),
        active: page === this.activePage,
      })),
    );
    abortSignal?.throwIfAborted();
    return {
      capturedAtMs: Date.now(),
      tabs,
    };
  }
}

export async function connectPlaywrightBrowser(
  cdpUrl: string,
  abortSignal?: AbortSignal,
): Promise<PlaywrightBrowser> {
  abortSignal?.throwIfAborted();
  const browser = await runBoundedControlOperation(
    async () =>
      await chromium.connectOverCDP(requireFirecrawlCdpUrl(cdpUrl), {
        timeout: BROWSER_CONTROL_TIMEOUT_MS,
      }),
    abortSignal,
  );
  abortSignal?.throwIfAborted();
  const context = browser.contexts()[0];
  if (!context) throw new Error("Firecrawl browser session has no browser context");
  const connected = new ConnectedPlaywrightBrowser(context);
  await connected.initialize(abortSignal);
  return connected;
}
