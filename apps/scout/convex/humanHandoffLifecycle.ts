import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { recordBrowserCleanupFailure } from "./scout/turns";
import {
  humanHandoffOutcomeEvent,
  humanHandoffScoutPausedEvent,
  humanHandoffWorkflow,
} from "./humanHandoffWorkflow";

export const waitForOutcome = humanHandoffWorkflow
  .define({
    args: { sessionId: v.id("scoutBrowserSessions") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const outcome = await step.awaitEvent(humanHandoffOutcomeEvent);
    if (outcome.kind === "continued") {
      await step.awaitEvent(humanHandoffScoutPausedEvent);
    }
    const evidence = await step.runAction(
      internal.humanHandoffBrowser.finishBrowserSession,
      {
        sessionId: args.sessionId,
        captureEvidence: outcome.kind === "continued",
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 } },
    );
    if (outcome.kind === "continued") {
      await step.runMutation(internal.scout.chats.resumeHumanHandoff, {
        sessionId: args.sessionId,
        evidence,
      });
    }
    return null;
  });

export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({
      sessionId: v.id("scoutBrowserSessions"),
      turnId: v.id("scoutTurns"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.result.kind !== "success") {
      await recordBrowserCleanupFailure(ctx, {
        ...args.context,
        failure:
          args.result.kind === "failed"
            ? args.result.error
            : "Human handoff cleanup workflow was canceled",
      });
    }
    await humanHandoffWorkflow.cleanup(ctx, args.workflowId);
    return null;
  },
});
