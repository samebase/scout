import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { scoutModelValidator } from "./models";
import { finishStoppingTurn } from "./turns";
import { scoutTurnWorkflow } from "./turnWorkflow";

export const run = scoutTurnWorkflow
  .define({
    args: {
      threadId: v.string(),
      userId: v.id("users"),
      promptMessageId: v.string(),
      model: scoutModelValidator,
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    while (true) {
      const result = await step.runAction(internal.scout.generation.runSlice, args, {
        retry: false,
      });
      if (result.kind === "completed") return null;
    }
  });

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
