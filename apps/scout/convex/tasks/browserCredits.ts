"use node";

import { setTimeout as wait } from "node:timers/promises";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { closeFirecrawlBrowserSession, createFirecrawlClient } from "../scout/lib/firecrawl";
import { diagnosticMessage } from "../scout/lib/redaction";
import { connectPlaywrightBrowser } from "../scout/playwrightBrowser";
import { omitNullish } from "../../shared/omitNullish";

export function taskBrowserBilling(ctx: ActionCtx, sessionId: Id<"agentsApiSessions">) {
  const firecrawl = createFirecrawlClient();
  let admission: {
    sessionId: Id<"agentsApiSessions">;
    billable: boolean;
    openedAtMs: number;
  } | null = null;
  let createdProviderId: string | null = null;
  let closed = false;

  const orphan = () => admission ?? undefined;
  const clear = () => {
    admission = null;
    createdProviderId = null;
    closed = false;
  };

  async function recordCleanupFailure(providerSessionId: string, error: unknown) {
    await ctx.runMutation(internal.tasks.browsers.unresolved, {
      providerSessionId,
      reason: diagnosticMessage(error),
      ...omitNullish({ orphan: orphan() }),
    });
  }

  return {
    closed: clear,
    failedOpen: async (error: unknown) => {
      if (createdProviderId && !closed) await recordCleanupFailure(createdProviderId, error);
      clear();
    },
    dependencies: {
      browser: async (options: Parameters<typeof firecrawl.browser>[0]) => {
        const billable = await ctx.runMutation(internal.tasks.browsers.admit, { sessionId });
        admission = { sessionId, billable, openedAtMs: Date.now() };
        const result = await firecrawl.browser(options);
        createdProviderId = result.id ?? null;
        if (!result.success && result.id) {
          const stopped = await closeFirecrawlBrowserSession(firecrawl, result.id);
          if (!stopped.success) {
            await recordCleanupFailure(result.id, stopped.error ?? "Firecrawl cleanup failed");
            throw new Error(stopped.error ?? "Firecrawl cleanup failed");
          }
          await ctx.runMutation(internal.tasks.browsers.close, {
            providerSessionId: result.id,
            providerDurationMs: stopped.sessionDurationMs ?? null,
            creditsBilled: stopped.creditsBilled ?? null,
            orphan: admission,
          });
          closed = true;
        }
        return result;
      },
      browserExecute: async (...args: Parameters<typeof firecrawl.browserExecute>) =>
        await firecrawl.browserExecute(...args),
      deleteBrowser: async (providerSessionId: string) => {
        try {
          const result = await closeFirecrawlBrowserSession(firecrawl, providerSessionId);
          if (result.success) {
            await ctx.runMutation(internal.tasks.browsers.close, {
              providerSessionId,
              providerDurationMs: result.sessionDurationMs ?? null,
              creditsBilled: result.creditsBilled ?? null,
              ...omitNullish({ orphan: orphan() }),
            });
            closed = true;
          } else {
            await recordCleanupFailure(
              providerSessionId,
              result.error ?? "Firecrawl cleanup failed",
            );
          }
          return result;
        } catch (error) {
          await recordCleanupFailure(providerSessionId, error);
          throw error;
        }
      },
      connect: connectPlaywrightBrowser,
      now: Date.now,
      sleep: async (milliseconds: number, abortSignal?: AbortSignal) =>
        await wait(milliseconds, undefined, abortSignal ? { signal: abortSignal } : undefined),
    },
  };
}
