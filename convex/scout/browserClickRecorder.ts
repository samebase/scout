"use node";

import { randomUUID } from "node:crypto";
import type { Infer } from "convex/values";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { z } from "zod";
import { browserClickCaptureValidator, MAX_BROWSER_CLICKS_PER_OPERATION } from "../browserModel";

export type BrowserClickCapture = Infer<typeof browserClickCaptureValidator>;
const pointerSchema = z.object({
  atMs: z.number().finite().nonnegative(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Click capture timed out")), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class BrowserClickRecorder {
  private readonly binding = `__scoutClick_${randomUUID().replaceAll("-", "")}`;
  private readonly startedAtMs = Date.now();
  private readonly clicks: Extract<BrowserClickCapture, { kind: "captured" }>["clicks"] = [];
  private readonly pending: Promise<void>[] = [];
  private readonly pages = new Set<Page>();
  private readonly sessions: Array<{ session: CDPSession; scriptId: string }> = [];
  private stopped = false;
  private incomplete = false;
  private truncated = false;

  private readonly context: BrowserContext;

  constructor(context: BrowserContext) {
    this.context = context;
  }

  private readonly onPage = (page: Page) => {
    this.incomplete = true;
    this.queuePage(page);
  };

  private queuePage(page: Page) {
    if (this.pages.has(page)) return;
    if (this.pending.length >= 16) {
      this.incomplete = true;
      return;
    }
    this.pages.add(page);
    this.pending.push(
      this.attach(page).catch(() => {
        this.incomplete = true;
      }),
    );
  }

  async start() {
    this.context.on("page", this.onPage);
    for (const page of this.context.pages()) this.queuePage(page);
    await Promise.all(this.pending);
  }

  private async attach(page: Page) {
    const connection = this.context.newCDPSession(page);
    let session: CDPSession;
    try {
      session = await bounded(connection);
    } catch (error) {
      void connection.then((late) => late.detach()).catch(() => undefined);
      throw error;
    }
    let scriptId: string | undefined;
    try {
      const { targetInfo } = await bounded(session.send("Target.getTargetInfo"));
      await bounded(session.send("Page.enable"));
      await bounded(session.send("Runtime.enable"));
      const before = Date.now();
      const remote = await bounded(
        session.send("Runtime.evaluate", {
          expression: "Date.now()",
          returnByValue: true,
        }),
      );
      const offset = (before + Date.now()) / 2 - z.number().finite().parse(remote.result.value);
      session.on("Runtime.bindingCalled", (event) => {
        if (this.stopped || event.name !== this.binding) return;
        try {
          const click = pointerSchema.parse(JSON.parse(event.payload));
          const atMs = click.atMs + offset;
          if (atMs < this.startedAtMs - 2_000 || atMs > Date.now() + 2_000) return;
          if (this.clicks.length >= MAX_BROWSER_CLICKS_PER_OPERATION) {
            this.truncated = true;
            return;
          }
          this.clicks.push({ ...click, atMs, tabId: targetInfo.targetId });
        } catch {
          this.incomplete = true;
        }
      });
      await bounded(session.send("Runtime.addBinding", { name: this.binding }));
      const source = `(() => {
        if (window !== window.top) return;
        globalThis[${JSON.stringify(`${this.binding}_stop`)}]?.();
        const handler = (event) => {
          if (!event.isTrusted || !innerWidth || !innerHeight) return;
          const send = globalThis[${JSON.stringify(this.binding)}];
          if (typeof send !== 'function') return;
          send(JSON.stringify({
            atMs: performance.timeOrigin + event.timeStamp,
            x: event.clientX / innerWidth, y: event.clientY / innerHeight
          }));
        };
        document.addEventListener('pointerdown', handler, true);
        globalThis[${JSON.stringify(`${this.binding}_stop`)}] = () => {
          document.removeEventListener('pointerdown', handler, true);
          delete globalThis[${JSON.stringify(`${this.binding}_stop`)}];
        };
      })()`;
      scriptId = (await bounded(session.send("Page.addScriptToEvaluateOnNewDocument", { source })))
        .identifier;
      await bounded(session.send("Runtime.evaluate", { expression: source }));
      this.sessions.push({ session, scriptId });
    } catch (error) {
      await this.cleanup(session, scriptId);
      throw error;
    }
  }

  private async cleanup(session: CDPSession, scriptId: string | undefined) {
    await Promise.allSettled([
      bounded(
        session.send("Runtime.evaluate", {
          expression: `globalThis[${JSON.stringify(`${this.binding}_stop`)}]?.()`,
        }),
      ),
      ...(scriptId
        ? [
            bounded(
              session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }),
            ),
          ]
        : []),
    ]);
    await bounded(session.send("Runtime.removeBinding", { name: this.binding })).catch(
      () => undefined,
    );
    await bounded(session.detach()).catch(() => undefined);
  }

  async finish(): Promise<BrowserClickCapture> {
    this.context.off("page", this.onPage);
    await Promise.all(this.pending);
    this.stopped = true;
    const endedAtMs = Date.now();
    await Promise.all(
      this.sessions.map(({ session, scriptId }) => this.cleanup(session, scriptId)),
    );
    if (this.sessions.length === 0) return { kind: "unavailable" };
    return {
      kind: "captured",
      startedAtMs: this.startedAtMs,
      endedAtMs,
      incomplete: this.incomplete,
      truncated: this.truncated,
      clicks: this.clicks.sort(
        (left, right) => left.atMs - right.atMs || left.tabId.localeCompare(right.tabId),
      ),
    };
  }
}
