import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Firecrawl } from "firecrawl";
import { chromium, type Browser } from "playwright-core";

const mode = process.argv[2];
if (mode !== "local" && mode !== "firecrawl") {
  throw new Error(
    "Usage: node scripts/research-browser-screenshots.ts local|firecrawl [chromium-path]",
  );
}
const viewport = { width: 1280, height: 800 };
const artifacts = await mkdtemp(join(tmpdir(), `scout-screenshots-${mode}-`));
console.log(`Screenshot trial artifacts: ${artifacts}`);
const captures: Array<{
  name: string;
  width: number;
  height: number;
  bytes: number;
  elapsedMs: number;
}> = [];
let browser: Browser | undefined;
let cleanupRemote: (() => Promise<void>) | undefined;

try {
  if (mode === "firecrawl") {
    const apiKey = process.env["FIRECRAWL_API_KEY"];
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required for the Firecrawl trial");
    const firecrawl = new Firecrawl({ apiKey });
    const session = await firecrawl.browser({ ttl: 180, activityTtl: 120 });
    if (!session.success || !session.id) throw new Error("Firecrawl did not create a session");
    const sessionId = session.id;
    cleanupRemote = async () => {
      const result = await firecrawl.deleteBrowser(sessionId);
      assert.equal(result.success, true);
    };
    if (!session.cdpUrl) throw new Error("Firecrawl did not provide a CDP URL");
    browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: 30_000 });
  } else {
    const executablePath = process.argv[3];
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  }

  const context = mode === "firecrawl" ? browser.contexts()[0] : await browser.newContext();
  assert.ok(context, "Browser context is required");
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);
  await page.setViewportSize(viewport);
  await page.goto("https://playwright.dev/docs/screenshots", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Screenshots", exact: true }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  async function readState() {
    return {
      ...(await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        clientWidth: document.documentElement.clientWidth,
        dpr: devicePixelRatio,
        scrollX,
        scrollY,
      }))),
      heading: await page.locator("h1").boundingBox(),
    };
  }
  const originalState = await readState();
  const states = [{ name: "initial", value: originalState }];
  async function capture(name: string, take: () => Promise<Buffer>) {
    const started = performance.now();
    const bytes = await take();
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    await writeFile(join(artifacts, `${name}.png`), bytes);
    captures.push({ name, ...dimensions, bytes: bytes.length, elapsedMs });
    states.push({ name, value: await readState() });
    return dimensions;
  }

  assert.deepEqual(
    await capture("viewport-1x", () => page.screenshot({ type: "png", scale: "css" })),
    viewport,
  );
  const cdp = await context.newCDPSession(page);
  try {
    for (const scale of [2, 3]) {
      assert.deepEqual(
        await capture(`viewport-cdp-${scale}x`, async () => {
          const result = await cdp.send("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: false,
            clip: { x: 0, y: 0, ...viewport, scale },
          });
          return Buffer.from(result.data, "base64");
        }),
        { width: viewport.width * scale, height: viewport.height * scale },
      );
    }
    await capture("element-1x", () =>
      page.locator("article").screenshot({ type: "png", scale: "css" }),
    );
    await capture("full-page-1x", () =>
      page.screenshot({ type: "png", scale: "css", fullPage: true }),
    );
  } finally {
    await cdp.detach();
  }

  const report = {
    mode,
    capturedAt: new Date().toISOString(),
    url: page.url(),
    browserVersion: browser.version(),
    originalState,
    cdpScalePreservedState: isDeepStrictEqual(states[1].value, states[2].value),
    states,
    captures,
  };
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await cleanupRemote?.();
  }
}
