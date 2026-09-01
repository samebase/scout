"use node";

import type { Firecrawl } from "firecrawl";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  closeFirecrawlBrowserSession,
  createFirecrawlClient,
  firecrawlBrowserExecutionSucceeded,
} from "./scout/lib/firecrawl";
import { optionalFirecrawlLiveViewUrl } from "./scout/lib/firecrawlLiveView";
import { diagnosticMessage } from "./scout/lib/redaction";

const MAX_HANDOFF_EVIDENCE_LENGTH = 20_000;

function boundedEvidence(value: string) {
  const evidence = value.trim();
  return evidence.length <= MAX_HANDOFF_EVIDENCE_LENGTH
    ? evidence
    : `${evidence.slice(0, MAX_HANDOFF_EVIDENCE_LENGTH - 1)}…`;
}

type BrowserFinishDependencies = {
  find: (providerSessionId: string) => Promise<ActiveBrowserSession | null>;
  captureSnapshot: (providerSessionId: string) => ReturnType<Firecrawl["browserExecute"]>;
  close: (providerSessionId: string) => ReturnType<Firecrawl["deleteBrowser"]>;
};

type ActiveBrowserSession = {
  sessionId: string;
  interactiveLiveViewUrl: string | null;
};

async function findActiveBrowserSessionWith(
  firecrawl: Pick<Firecrawl, "listBrowsers">,
  providerSessionId: string,
): Promise<ActiveBrowserSession | null> {
  const response = await firecrawl.listBrowsers({ status: "active" });
  if (!response.success) {
    throw new Error(response.error?.trim() || "Firecrawl could not list browser sessions");
  }
  const session = response.sessions?.find(
    (candidate) => candidate.id === providerSessionId && candidate.status === "active",
  );
  return session
    ? {
        sessionId: session.id,
        interactiveLiveViewUrl: optionalFirecrawlLiveViewUrl(session.interactiveLiveViewUrl),
      }
    : null;
}

export async function findActiveBrowserSession(providerSessionId: string) {
  return await findActiveBrowserSessionWith(createFirecrawlClient(), providerSessionId);
}

function browserFinishDependencies(): BrowserFinishDependencies {
  const firecrawl = createFirecrawlClient({ maxRetries: 1 });
  return {
    find: async (providerSessionId) =>
      await findActiveBrowserSessionWith(firecrawl, providerSessionId),
    captureSnapshot: async (providerSessionId) =>
      await firecrawl.browserExecute(providerSessionId, {
        code: "agent-browser snapshot -i",
        language: "bash",
        timeout: 60,
      }),
    close: async (providerSessionId) =>
      await closeFirecrawlBrowserSession(firecrawl, providerSessionId),
  };
}

export async function finishHandedOffBrowser(
  args: { providerSessionId: string; captureEvidence: boolean },
  dependencies: BrowserFinishDependencies = browserFinishDependencies(),
) {
  let evidence = "The operator returned control without a final browser snapshot.";
  let active: Awaited<ReturnType<typeof findActiveBrowserSession>> | undefined;
  try {
    active = await dependencies.find(args.providerSessionId);
  } catch (error) {
    evidence = `Scout could not verify the handed-off browser before closing it: ${boundedEvidence(diagnosticMessage(error))}`;
  }
  if (active === null) {
    return {
      evidence: "The browser session ended before Scout could inspect the completed human step.",
      providerDurationMs: null,
      creditsBilled: null,
    };
  }
  if (active && args.captureEvidence) {
    try {
      const snapshot = await dependencies.captureSnapshot(args.providerSessionId);
      evidence = firecrawlBrowserExecutionSucceeded(snapshot)
        ? boundedEvidence(snapshot.stdout ?? snapshot.result ?? snapshot.output ?? "")
        : `The post-handoff browser snapshot failed: ${boundedEvidence(snapshot.stderr || snapshot.error || "Unknown provider failure")}`;
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
    sessionId: v.id("taskBrowserSessions"),
    captureEvidence: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const session = await ctx.runQuery(internal.tasks.handoffBrowserSession, {
      sessionId: args.sessionId,
    });
    if (!session || session.lifecycle.kind === "closed") {
      return "The browser session had already ended before Scout resumed.";
    }

    const result = await finishHandedOffBrowser({
      providerSessionId: session.providerSessionId,
      captureEvidence: args.captureEvidence,
    });
    await ctx.runMutation(internal.tasks.closeBrowserSessionRecord, {
      sessionId: args.sessionId,
      providerDurationMs: result.providerDurationMs,
      creditsBilled: result.creditsBilled,
    });
    return result.evidence;
  },
});
