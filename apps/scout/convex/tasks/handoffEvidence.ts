"use node";

import { chromium, type Frame } from "playwright-core";
import { type HandoffEvidence } from "./handoffEvidenceModel";

const MAX_OPEN_TABS = 16;
const MAX_PAGE_CONTENT = 32_000;
const MAX_TOTAL_CONTENT = 128_000;
const CONNECT_TIMEOUT_MS = 10_000;
const CAPTURE_TIMEOUT_MS = 20_000;
const PAGE_TIMEOUT_MS = 5_000;
// Firecrawl's CDP proxy took just over five seconds to close in live trials.
const DISCONNECT_TIMEOUT_MS = 10_000;

async function readBefore<T>(operation: () => Promise<T>, deadline: number, step: string) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new Error(`Handoff evidence ${step} timed out`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch(() => {
          // Native errors can contain CDP credentials or page text. Do not retain their causes.
          throw new Error(`Handoff evidence ${step} failed`);
        }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Handoff evidence ${step} timed out`)),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function evidenceUrl(value: string) {
  if (value.length > 4_096) throw new Error("Handoff evidence URL exceeds 4096 characters");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Handoff evidence tab has an invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Handoff evidence requires HTTP or HTTPS tabs");
  }
  // Match the browser observer's query/fragment redaction and remove URL credentials.
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function passwordValues(frame: Frame, deadline: number) {
  return await readBefore(
    () =>
      frame.locator("input").evaluateAll((inputs) => {
        const values: string[] = [];
        let length = 0;
        for (const input of inputs) {
          if (!(input instanceof HTMLInputElement)) throw new Error("Expected an input");
          if (input.type !== "password" || !input.value) continue;
          length += input.value.length;
          if (values.length >= 256 || length > 32_000) throw new Error("Password scan limit");
          values.push(input.value);
        }
        return values;
      }),
    deadline,
    "password protection",
  );
}

function redactPasswords(snapshot: string, passwords: string[]) {
  const variants = new Set<string>();
  for (const password of passwords) {
    // Playwright normalizes whitespace; YAML strings and accessible names can escape quotes.
    for (const value of [
      password,
      password
        .replace(/[\u200b\u00ad]/g, "")
        .trim()
        .replace(/\s+/g, " "),
    ]) {
      if (!value) continue;
      variants.add(value);
      variants.add(JSON.stringify(value).slice(1, -1));
      variants.add(value.replaceAll("'", "''"));
    }
  }
  const pattern = [...variants]
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return pattern ? snapshot.replace(new RegExp(pattern, "g"), "[password redacted]") : snapshot;
}

/**
 * Reads all current nonblank tabs without selecting an active tab. capturedAt is
 * the completion time; the sequential page reads are not an atomic browser snapshot.
 * Oversized or changing tab sets fail in full. Content is untrusted ARIA text.
 */
export async function captureHandoffEvidence(cdpUrl: string): Promise<HandoffEvidence> {
  const browser = await chromium
    .connectOverCDP(cdpUrl, { noDefaults: true, timeout: CONNECT_TIMEOUT_MS })
    .catch(() => {
      throw new Error("Handoff evidence CDP connection failed");
    });
  try {
    const deadline = performance.now() + CAPTURE_TIMEOUT_MS;
    const openPages = () => browser.contexts().flatMap((context) => context.pages());
    // A listener prevents Playwright's automatic dismissal of newly opened dialogs.
    for (const context of browser.contexts()) context.on("dialog", () => {});
    const initialPages = openPages();
    if (initialPages.length > MAX_OPEN_TABS) {
      throw new Error("Handoff evidence exceeds 16 open tabs");
    }
    const nonblankPages = initialPages.filter((page) => !/^about:blank(?:[?#]|$)/.test(page.url()));
    if (nonblankPages.length === 0) throw new Error("Handoff evidence has no nonblank tabs");
    const initialUrls = new Map(initialPages.map((page) => [page, page.url()]));
    let changed = false;
    for (const page of initialPages) {
      const markChanged = () => {
        changed = true;
      };
      page.on("framenavigated", markChanged);
      page.on("frameattached", markChanged);
      page.on("framedetached", markChanged);
    }

    const pages: HandoffEvidence["pages"] = [];
    let totalContent = 0;
    for (const page of nonblankPages) {
      const pageDeadline = Math.min(deadline, performance.now() + PAGE_TIMEOUT_MS);
      const url = evidenceUrl(page.url());
      const session = await readBefore(
        () => page.context().newCDPSession(page),
        pageDeadline,
        "tab attachment",
      );
      let tabId: string;
      try {
        const { targetInfo } = await readBefore(
          () => session.send("Target.getTargetInfo"),
          pageDeadline,
          "target lookup",
        );
        tabId = targetInfo.targetId;
      } finally {
        await readBefore(() => session.detach(), pageDeadline, "tab detachment");
      }
      if (!tabId || tabId.length > 256) throw new Error("Handoff evidence has an invalid tab ID");
      const title = await readBefore(() => page.title(), pageDeadline, "title read");
      if (title.length > 1_024) throw new Error("Handoff evidence title exceeds 1024 characters");
      const frames = page.frames();
      if (frames.length > 16) throw new Error("Handoff evidence exceeds 16 frames in a tab");
      const snapshots: string[] = [];
      for (const frame of frames) {
        // Playwright 1.62 includes password values. Keep them only in memory for redaction.
        const passwords = await passwordValues(frame, pageDeadline);
        // Read each frame explicitly: AI mode silently omits frames whose snapshots fail.
        const snapshot = await readBefore(
          () => frame.locator("body").ariaSnapshot({ timeout: PAGE_TIMEOUT_MS }),
          pageDeadline,
          "ARIA snapshot",
        );
        const afterPasswords = await passwordValues(frame, pageDeadline);
        if (JSON.stringify(passwords) !== JSON.stringify(afterPasswords)) {
          throw new Error("Handoff evidence password inputs changed during capture; capture again");
        }
        if (snapshot.length > MAX_PAGE_CONTENT) {
          throw new Error("Handoff evidence page content exceeds 32000 characters");
        }
        snapshots.push(redactPasswords(snapshot, passwords));
      }
      if (frames.length !== page.frames().length || frames.some((frame) => frame.isDetached())) {
        throw new Error("Handoff evidence frames changed during capture; capture again");
      }
      const content = snapshots
        .map((snapshot, index) => (index === 0 ? snapshot : `Frame ${index + 1}:\n${snapshot}`))
        .join("\n\n");
      if (content.length > MAX_PAGE_CONTENT) {
        throw new Error("Handoff evidence page content exceeds 32000 characters");
      }
      totalContent += content.length;
      if (totalContent > MAX_TOTAL_CONTENT) {
        throw new Error("Handoff evidence total content exceeds 128000 characters");
      }
      pages.push({ tabId, url, title, content });
    }
    const finalPages = openPages();
    if (
      changed ||
      initialPages.length !== finalPages.length ||
      finalPages.some((page) => page.isClosed() || initialUrls.get(page) !== page.url())
    ) {
      throw new Error("Handoff evidence tabs changed during capture; capture again");
    }
    pages.sort((a, b) => (a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0));
    return { capturedAt: Date.now(), pages };
  } finally {
    // connectOverCDP's close disconnects this transport; it does not close remote Chrome.
    await readBefore(
      () => browser.close(),
      performance.now() + DISCONNECT_TIMEOUT_MS,
      "CDP disconnect",
    );
  }
}
