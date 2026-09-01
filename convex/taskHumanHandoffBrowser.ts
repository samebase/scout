"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  closeBrowserSession,
  executeBrowserCode,
  findActiveBrowserSession,
} from "./scout/lib/firecrawl";
import { diagnosticMessage } from "./scout/lib/redaction";

const MAX_HANDOFF_EVIDENCE_LENGTH = 20_000;

function boundedEvidence(value: string) {
  const evidence = value.trim();
  return evidence.length <= MAX_HANDOFF_EVIDENCE_LENGTH
    ? evidence
    : `${evidence.slice(0, MAX_HANDOFF_EVIDENCE_LENGTH - 1)}…`;
}

type BrowserFinishDependencies = {
  find: typeof findActiveBrowserSession;
  execute: typeof executeBrowserCode;
  close: typeof closeBrowserSession;
};

const browserFinishDependencies: BrowserFinishDependencies = {
  find: findActiveBrowserSession,
  execute: executeBrowserCode,
  close: closeBrowserSession,
};

export async function finishHandedOffBrowser(
  args: { providerSessionId: string; captureEvidence: boolean },
  dependencies: BrowserFinishDependencies = browserFinishDependencies,
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
      const snapshot = await dependencies.execute(
        args.providerSessionId,
        "agent-browser snapshot -i",
        60,
        "bash",
        "read",
      );
      evidence = snapshot.success
        ? boundedEvidence(snapshot.stdout)
        : `The post-handoff browser snapshot failed: ${boundedEvidence(snapshot.stderr)}`;
    } catch (error) {
      evidence = `The post-handoff browser snapshot failed: ${boundedEvidence(diagnosticMessage(error))}`;
    }
  }
  const stopped = await dependencies.close(args.providerSessionId);
  if (!stopped.success) throw new Error("Firecrawl did not stop the handed-off browser session");
  return {
    evidence,
    providerDurationMs: stopped.sessionDurationMs,
    creditsBilled: stopped.creditsBilled,
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
