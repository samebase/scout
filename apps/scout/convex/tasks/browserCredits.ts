"use node";

import { SdkError } from "firecrawl";
import { setTimeout as wait } from "node:timers/promises";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { creditsEnabled } from "../creditPolicy";
import { closeFirecrawlBrowserSession, createFirecrawlClient } from "../scout/lib/firecrawl";
import { diagnosticMessage } from "../scout/lib/redaction";
import { connectPlaywrightBrowser } from "../scout/playwrightBrowser";
import { omitNullish } from "../../shared/omitNullish";

export function taskBrowserCredits(ctx: ActionCtx, sessionId: Id<"agentsApiSessions">) {
  const firecrawl = createFirecrawlClient();
  let funding: { reservationId: Id<"creditReservations">; durationSeconds: number } | null = null;
  let createdProviderId: string | null = null;
  let creationWasRejected = false;

  async function unresolvedBrowser(providerSessionId: string, error: unknown) {
    await ctx.runMutation(internal.tasks.browsers.unresolved, {
      providerSessionId,
      ...omitNullish({ reservationId: funding?.reservationId }),
      reason: diagnosticMessage(error),
    });
  }

  return {
    reservationId: () => funding?.reservationId,
    closed: () => {
      funding = null;
      createdProviderId = null;
      creationWasRejected = false;
    },
    failedOpen: async (error: unknown) => {
      if (!funding) return;
      if (createdProviderId) {
        await unresolvedBrowser(createdProviderId, error);
      } else if (
        creationWasRejected ||
        (error instanceof SdkError &&
          error.status === 409 &&
          /another session is currently writing to this profile/i.test(error.message))
      ) {
        await ctx.runMutation(internal.credits.release, {
          reservationId: funding.reservationId,
          reason: "Firecrawl rejected browser creation before a session was opened",
        });
      } else {
        await ctx.runMutation(internal.credits.unresolved, {
          reservationId: funding.reservationId,
          reason: `Firecrawl browser creation returned no session ID: ${diagnosticMessage(error)}`,
        });
      }
      funding = null;
      createdProviderId = null;
      creationWasRejected = false;
    },
    dependencies: {
      browser: async (options: Parameters<typeof firecrawl.browser>[0]) => {
        if (creditsEnabled() && !funding)
          funding = await ctx.runMutation(internal.tasks.browsers.reserve, { sessionId });
        const requestedAt = Date.now();
        const result = await firecrawl.browser(
          funding
            ? { ...options, ttl: funding.durationSeconds, activityTtl: funding.durationSeconds }
            : options,
        );
        createdProviderId = result.id ?? null;
        creationWasRejected = !result.success && !result.id;
        if (!result.success && result.id && funding) {
          const stopped = await closeFirecrawlBrowserSession(firecrawl, result.id);
          if (!stopped.success) {
            await unresolvedBrowser(result.id, stopped.error ?? "Firecrawl cleanup failed");
            throw new Error(stopped.error ?? "Firecrawl cleanup failed");
          }
          await ctx.runMutation(internal.tasks.browsers.close, {
            providerSessionId: result.id,
            reservationId: funding.reservationId,
            providerDurationMs: stopped.sessionDurationMs ?? null,
            creditsBilled: stopped.creditsBilled ?? null,
          });
        }
        if (!result.success || !funding) return result;
        const providerExpiry = result.expiresAt ? Date.parse(result.expiresAt) : Infinity;
        const fundedExpiry = requestedAt + funding.durationSeconds * 1_000;
        return {
          ...result,
          expiresAt: new Date(
            Number.isFinite(providerExpiry) ? Math.min(providerExpiry, fundedExpiry) : fundedExpiry,
          ).toISOString(),
        };
      },
      browserExecute: async (...args: Parameters<typeof firecrawl.browserExecute>) =>
        await firecrawl.browserExecute(...args),
      deleteBrowser: async (providerSessionId: string) => {
        try {
          const result = await closeFirecrawlBrowserSession(firecrawl, providerSessionId);
          if (funding) {
            if (result.success) {
              await ctx.runMutation(internal.tasks.browsers.close, {
                providerSessionId,
                reservationId: funding.reservationId,
                providerDurationMs: result.sessionDurationMs ?? null,
                creditsBilled: result.creditsBilled ?? null,
              });
            } else {
              await unresolvedBrowser(
                providerSessionId,
                result.error ?? "Firecrawl cleanup failed",
              );
            }
          }
          return result;
        } catch (error) {
          if (funding) await unresolvedBrowser(providerSessionId, error);
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
