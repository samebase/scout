"use node";

import { type Infer } from "convex/values";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
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
  disconnect: () => Promise<void>;
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
  selectTab: (tabId: string, abortSignal?: AbortSignal) => Promise<boolean>;
  selectedTabId: () => Promise<string | null>;
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
  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private activePage: Page;
  private readonly tabIds = new Map<Page, Promise<string>>();
  private clickRecorder: BrowserClickRecorder | null = null;
  private dialogsHandled: Promise<void> = Promise.resolve();
  private dialogFailure: { error: unknown } | null = null;

  private async checkDialogs(abortSignal?: AbortSignal) {
    await runBoundedControlOperation(async () => await this.dialogsHandled, abortSignal);
    if (this.dialogFailure) throw this.dialogFailure.error;
  }

  private async withDialogs<T>(operation: () => Promise<T>, abortSignal?: AbortSignal) {
    await this.checkDialogs(abortSignal);
    try {
      return await operation();
    } finally {
      await this.checkDialogs(abortSignal);
    }
  }

  async startClickCapture() {
    await this.withDialogs(async () => {
      this.clickRecorder = new BrowserClickRecorder(this.context);
      await this.clickRecorder.start();
    });
  }

  async finishClickCapture(): Promise<BrowserClickCapture> {
    const recorder = this.clickRecorder;
    this.clickRecorder = null;
    try {
      return recorder ? await recorder.finish() : { kind: "unavailable" };
    } finally {
      await this.checkDialogs();
    }
  }

  constructor(browser: Browser, context: BrowserContext) {
    this.browser = browser;
    this.context = context;
    context.on("dialog", (dialog) => {
      const method = dialog.type() === "beforeunload" ? "accept" : "dismiss";
      // Playwright's server auto-handler leaves this rejection unhandled when
      // another CDP client has already closed the dialog. Keep its default policy.
      const handled = dialog[method]().catch((error: unknown) => {
        const alreadyHandled = "Protocol error (Page.handleJavaScriptDialog): No dialog is showing";
        if (
          error instanceof Error &&
          (error.message === alreadyHandled ||
            error.message === `dialog.${method}: ${alreadyHandled}`)
        ) {
          return;
        }
        this.dialogFailure ??= { error };
      });
      this.dialogsHandled = Promise.all([this.dialogsHandled, handled]).then(() => undefined);
    });
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

  async disconnect() {
    // For connectOverCDP, close disconnects the transport and leaves remote Chrome running.
    try {
      await this.browser.close();
    } finally {
      await this.checkDialogs();
    }
  }

  async initialize(abortSignal?: AbortSignal) {
    await this.withDialogs(
      async () =>
        await runBoundedControlOperation(
          async () => await this.activePage.setViewportSize(VIEWPORT),
          abortSignal,
        ),
      abortSignal,
    );
  }

  async selectTab(tabId: string, abortSignal?: AbortSignal) {
    return await this.withDialogs(async () => {
      for (const page of this.context.pages()) {
        if (!page.isClosed() && (await this.tabId(page, abortSignal)) === tabId) {
          this.activePage = page;
          return true;
        }
      }
      return false;
    }, abortSignal);
  }

  async selectedTabId() {
    return await this.withDialogs(async () =>
      this.activePage.isClosed() ? null : await this.tabId(this.activePage),
    );
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
    const snapshot = await this.withDialogs(
      async () =>
        await this.page()
          .locator("body")
          .ariaSnapshot(
            omitNullish({
              mode: "ai",
              timeout: SNAPSHOT_TIMEOUT_MS,
              signal: abortSignal,
            }),
          ),
      abortSignal,
    );
    // AI mode includes iframe contents. Match each YAML key (plain or single-quoted)
    // before removing its reference metadata, leaving names and text values intact.
    return snapshot.replace(
      /^[ \t]*- (?:'(?:[^'\n]|'')*'|[^'\n][^\n]*?)(?=:(?: |$)|$)/gm,
      (header) => header.replace(/ \[ref=[^[\]\s]+\](?=(?: \[[^[\]\n]*\])*'?$)/, ""),
    );
  }

  async navigate(url: string, abortSignal?: AbortSignal) {
    await this.withDialogs(
      async () =>
        await this.page().goto(
          url,
          omitNullish({ waitUntil: "domcontentloaded", signal: abortSignal }),
        ),
      abortSignal,
    );
  }

  async getPage(kind: "url" | "title", abortSignal?: AbortSignal) {
    return await this.withDialogs(
      async () =>
        kind === "url"
          ? this.page().url()
          : await runBoundedControlOperation(async () => await this.page().title(), abortSignal),
      abortSignal,
    );
  }

  async getElement(target: BrowserTarget, abortSignal?: AbortSignal) {
    return await this.withDialogs(
      async () => await this.locator(target).innerText(omitNullish({ signal: abortSignal })),
      abortSignal,
    );
  }

  async getElementAttribute(target: BrowserTarget, attribute: "type", abortSignal?: AbortSignal) {
    return (
      (await this.withDialogs(
        async () =>
          await this.locator(target).getAttribute(attribute, omitNullish({ signal: abortSignal })),
        abortSignal,
      )) ?? ""
    );
  }

  async fill(target: BrowserTarget, text: string, abortSignal?: AbortSignal) {
    await this.withDialogs(
      async () => await this.locator(target).fill(text, omitNullish({ signal: abortSignal })),
      abortSignal,
    );
  }

  async observe(abortSignal?: AbortSignal) {
    return await this.withDialogs(async () => {
      const pages = this.context.pages().filter((page) => !page.isClosed());
      if (pages.length === 0) throw new Error("The browser has no open tab");
      if (this.activePage.isClosed()) this.activePage = pages.at(-1) ?? pages[0];
      const tabs = await Promise.all(
        pages.map(async (page) => ({
          tabId: await this.tabId(page, abortSignal),
          title: await runBoundedControlOperation(
            async () => await page.title(),
            abortSignal,
          ).catch(() => ""),
          url: displayUrl(page.url()),
          active: page === this.activePage,
        })),
      );
      abortSignal?.throwIfAborted();
      return {
        capturedAtMs: Date.now(),
        tabs,
      };
    }, abortSignal);
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
  try {
    abortSignal?.throwIfAborted();
    const context = browser.contexts()[0];
    if (!context) throw new Error("Firecrawl browser session has no browser context");
    const connected = new ConnectedPlaywrightBrowser(browser, context);
    await connected.initialize(abortSignal);
    return connected;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
