"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  closeBrowserSession,
  executeBrowserCode,
  findActiveBrowserSession,
} from "./scout/lib/firecrawl";

const MAX_HANDOFF_EVIDENCE_LENGTH = 20_000;

function boundedEvidence(value: string) {
  const evidence = value.trim();
  return evidence.length <= MAX_HANDOFF_EVIDENCE_LENGTH
    ? evidence
    : `${evidence.slice(0, MAX_HANDOFF_EVIDENCE_LENGTH - 1)}…`;
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

    const active = await findActiveBrowserSession(session.providerSessionId);
    if (!active) {
      await ctx.runMutation(internal.tasks.closeBrowserSessionRecord, {
        sessionId: args.sessionId,
        providerDurationMs: null,
        creditsBilled: null,
      });
      return "The browser session ended before Scout could inspect the completed human step.";
    }

    let evidence = "The operator returned control without a final browser snapshot.";
    if (args.captureEvidence) {
      const snapshot = await executeBrowserCode(
        session.providerSessionId,
        "agent-browser snapshot -i",
        60,
        "bash",
        "read",
      );
      evidence = snapshot.success
        ? boundedEvidence(snapshot.stdout)
        : `The post-handoff browser snapshot failed: ${boundedEvidence(snapshot.stderr)}`;
    }

    const stopped = await closeBrowserSession(session.providerSessionId);
    if (!stopped.success) throw new Error("Firecrawl did not stop the handed-off browser session");
    await ctx.runMutation(internal.tasks.closeBrowserSessionRecord, {
      sessionId: args.sessionId,
      providerDurationMs: stopped.sessionDurationMs,
      creditsBilled: stopped.creditsBilled,
    });
    return evidence;
  },
});
