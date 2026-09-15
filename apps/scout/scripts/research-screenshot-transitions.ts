import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Firecrawl } from "firecrawl";
import { outdent } from "outdent";
import { chromium, type Browser, type Page } from "playwright-core";

const apiKey = process.env["FIRECRAWL_API_KEY"];
if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required");
const firecrawl = new Firecrawl({ apiKey, maxRetries: 1, timeoutMs: 60_000 });
const artifacts = await mkdtemp(join(tmpdir(), "scout-screenshot-transitions-"));
console.log(`Screenshot transition artifacts: ${artifacts}`);
const viewport = { width: 1280, height: 800 };
const captures: Awaited<ReturnType<typeof capture>>[] = [];
let browser: Browser | undefined;
const session = await firecrawl.browser({ ttl: 180, activityTtl: 120 });
assert.ok(session.success && session.id, "Firecrawl did not create a session");
const sessionId = session.id;

async function tabId(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    return (await cdp.send("Target.getTargetInfo")).targetInfo.targetId;
  } finally {
    await cdp.detach();
  }
}

async function pageById(connectedBrowser: Browser, id: string) {
  for (const context of connectedBrowser.contexts()) {
    for (const page of context.pages()) {
      if ((await tabId(page)) === id) return page;
    }
  }
  throw new Error("Selected browser tab is closed");
}

async function capture(page: Page, name: string, reason: string) {
  const cdp = await page.context().newCDPSession(page);
  const id = await tabId(page);
  try {
    const readState = async () => {
      const metrics = await cdp.send("Page.getLayoutMetrics");
      const { frameTree } = await cdp.send("Page.getFrameTree");
      return {
        url: page.url(),
        title: await page.title(),
        loaderId: frameTree.frame.loaderId,
        viewport: metrics.cssVisualViewport,
        documentSize: metrics.cssContentSize,
      };
    };
    const before = await readState();
    const { pageX, pageY } = before.viewport;
    const startedAtMs = Date.now();
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: pageX, y: pageY, ...viewport, scale: 2 },
    });
    const completedAtMs = Date.now();
    const after = await readState();
    assert.deepEqual(after, before, "Capture changed tab or viewport state");
    const bytes = Buffer.from(data, "base64");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.deepEqual({ width, height }, { width: 2560, height: 1600 });
    await writeFile(join(artifacts, `${name}.png`), bytes);
    const result = {
      name,
      reason,
      tabId: id,
      startedAtMs,
      completedAtMs,
      bytes: bytes.length,
      width,
      height,
      state: before,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await cdp.detach();
  }
}

try {
  assert.ok(session.cdpUrl, "Firecrawl did not provide a CDP URL");
  browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: 30_000 });
  const context = browser.contexts()[0];
  assert.ok(context, "Browser context is required");
  const page = context.pages()[0];
  assert.ok(page, "New session has no initial page");
  await page.setViewportSize(viewport);
  await page.goto("https://playwright.dev/docs/screenshots", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Screenshots", exact: true }).waitFor();
  await page.evaluate(async () => await document.fonts.ready.then(() => undefined));
  const firstId = await tabId(page);
  captures.push(await capture(page, "01-top", "Starting page before scrolling"));

  const execution = await firecrawl.browserExecute(sessionId, {
    language: "node",
    code: outdent`
      await (async () => {
        for (const candidate of page.context().pages()) {
          const cdp = await candidate.context().newCDPSession(candidate);
          const id = (await cdp.send("Target.getTargetInfo")).targetInfo.targetId;
          await cdp.detach();
          if (id === ${JSON.stringify(firstId)}) {
            await candidate.evaluate(() => window.scrollTo(0, 600));
            await candidate.waitForFunction(() => window.scrollY >= 600);
            return "scrolled selected tab";
          }
        }
        throw new Error("Selected browser tab is closed");
      })()
    `,
  });
  assert.ok(execution.success && !execution.error && !execution.killed);
  assert.ok(
    execution.exitCode === undefined || execution.exitCode === null || execution.exitCode === 0,
  );
  assert.ok((await page.evaluate(() => window.scrollY)) >= 600);
  captures.push(await capture(page, "02-scrolled", "Capture after a Firecrawl execute call"));

  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(() => window.open("https://example.com/", "_blank"));
  const popup = await popupPromise;
  await popup.waitForLoadState("load");
  await popup.setViewportSize(viewport);
  await popup.getByRole("heading", { name: "Example Domain", exact: true }).waitFor();
  const secondId = await tabId(popup);
  assert.notEqual(firstId, secondId);
  captures.push(await capture(popup, "03-popup", "New tab has its own source identity"));

  await popup.goto("https://playwright.dev/docs/pages", { waitUntil: "load" });
  await popup.getByRole("heading", { name: "Pages", exact: true }).waitFor();
  assert.equal(await tabId(popup), secondId);
  captures.push(await capture(popup, "04-navigation", "Navigation retains tab ID and changes URL"));

  await browser.close();
  browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: 30_000 });
  const restored = await pageById(browser, firstId);
  assert.ok((await restored.evaluate(() => window.scrollY)) >= 600);
  captures.push(
    await capture(
      restored,
      "05-reconnected",
      "Select the original scrolled tab by ID after reconnect",
    ),
  );
  await restored.close();
  await assert.rejects(pageById(browser, firstId), /Selected browser tab is closed/);
  assert.equal(await tabId(await pageById(browser, secondId)), secondId);

  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify({ captures, closedTargetRejected: true }, null, 2) + "\n",
  );
  console.log("Verified scroll, popup, navigation, reconnect, and rejection of a closed target.");
} finally {
  try {
    await browser?.close();
  } finally {
    const removed = await firecrawl.deleteBrowser(sessionId);
    assert.equal(removed.success, true);
    console.log("Disposable Firecrawl session deleted.");
  }
}
