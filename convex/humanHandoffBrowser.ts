"use node";

import type { Firecrawl } from "firecrawl";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { closeFirecrawlBrowserSession, createFirecrawlClient } from "./scout/lib/firecrawl";
import { diagnosticMessage } from "./scout/lib/redaction";
import { connectPlaywrightBrowser } from "./scout/playwrightBrowser";
import { omitNullish } from "../shared/omitNullish";

const MAX_HANDOFF_EVIDENCE_LENGTH = 20_000;

function boundedEvidence(value: string) {
  const evidence = value.trim();
  return evidence.length <= MAX_HANDOFF_EVIDENCE_LENGTH
    ? evidence
    : `${evidence.slice(0, MAX_HANDOFF_EVIDENCE_LENGTH - 1)}…`;
}

type BrowserFinishDependencies = {
  captureSnapshot: (cdpUrl: string) => Promise<string>;
  close: (providerSessionId: string) => ReturnType<Firecrawl["deleteBrowser"]>;
};

function browserFinishDependencies(): BrowserFinishDependencies {
  const firecrawl = createFirecrawlClient();
  return {
    captureSnapshot: async (cdpUrl) => await (await connectPlaywrightBrowser(cdpUrl)).snapshot(),
    close: async (providerSessionId) =>
      await closeFirecrawlBrowserSession(firecrawl, providerSessionId),
  };
}

export async function finishHandedOffBrowser(
  args: { providerSessionId: string; cdpUrl: string; captureEvidence: boolean },
  dependencies: BrowserFinishDependencies = browserFinishDependencies(),
) {
  let evidence = "The operator returned control without a final browser snapshot.";
  if (args.captureEvidence) {
    try {
      evidence = boundedEvidence(await dependencies.captureSnapshot(args.cdpUrl));
    } catch (error) {
      evidence = `The post-handoff browser snapshot failed: ${boundedEvidence(diagnosticMessage(error))}`;
    }
  }
  const stopped = await dependencies.close(args.providerSessionId);
  if (!stopped.success) {
    throw new Error(
      stopped.error?.trim() || "Firecrawl did not stop the handed-off browser session",
    );
  }
  return {
    evidence,
    providerDurationMs: stopped.sessionDurationMs ?? null,
    creditsBilled: stopped.creditsBilled ?? null,
  };
}

export const finishBrowserSession = internalAction({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    captureEvidence: v.boolean(),
    usageTurnId: v.optional(v.id("scoutTurns")),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const session = await ctx.runQuery(internal.scout.browserSessions.getForHandoff, {
      sessionId: args.sessionId,
    });
    if (!session || session.lifecycle.kind === "closed") {
      return "The browser session had already ended before Scout resumed.";
    }

    let result: Awaited<ReturnType<typeof finishHandedOffBrowser>>;
    try {
      result = await finishHandedOffBrowser({
        providerSessionId: session.providerSessionId,
        cdpUrl: session.lifecycle.cdpUrl,
        captureEvidence: args.captureEvidence,
      });
    } catch (error) {
      await ctx.runMutation(internal.scout.browserSessions.close, {
        sessionId: args.sessionId,
        providerDurationMs: null,
        creditsBilled: null,
        ...omitNullish({ usageTurnId: args.usageTurnId }),
      });
      throw error;
    }
    await ctx.runMutation(internal.scout.browserSessions.close, {
      sessionId: args.sessionId,
      providerDurationMs: result.providerDurationMs,
      creditsBilled: result.creditsBilled,
      ...omitNullish({ usageTurnId: args.usageTurnId }),
    });
    return result.evidence;
  },
});
