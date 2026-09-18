import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { finishStoppingTurn, recordBrowserCleanupFailure } from "./turns";
import { scoutTurnWorkflow } from "./turnWorkflow";

export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ turnId: v.id("scoutTurns") }),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.result.kind !== "success") {
      const failure =
        args.result.kind === "failed"
          ? `Scout workflow failed: ${args.result.error}`
          : "Scout workflow was canceled";
      await ctx.runMutation(internal.scout.turns.failWorkflow, {
        turnId: args.context.turnId,
        failure,
      });
    }
    await finishStoppingTurn(ctx, args.context.turnId);
    await scoutTurnWorkflow.cleanup(ctx, args.workflowId);
    return null;
  },
});

export const cleanupBrowser = scoutTurnWorkflow
  .define({
    args: {
      sessionId: v.id("scoutBrowserSessions"),
      turnId: v.id("scoutTurns"),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    await step.runAction(
      internal.humanHandoffBrowser.finishBrowserSession,
      {
        sessionId: args.sessionId,
        captureEvidence: false,
        usageTurnId: args.turnId,
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 } },
    );
    return null;
  });

export const onBrowserCleanupComplete = internalMutation({
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
            : "Browser cleanup workflow was canceled",
      });
    }
    await scoutTurnWorkflow.cleanup(ctx, args.workflowId);
    return null;
  },
});
