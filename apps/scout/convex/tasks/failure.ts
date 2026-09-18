import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { taskFailureDiagnosticValidator } from "../../shared/taskFailure";

export const record = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    workflowId: v.union(vWorkflowId, v.null()),
    error: v.string(),
    diagnostic: taskFailureDiagnosticValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (
      !session ||
      session.state.kind === "stopped" ||
      session.state.kind === "failed" ||
      (session.workflowId ?? null) !== args.workflowId
    )
      return null;
    await ctx.db.patch(session._id, {
      state: { kind: "failed", error: args.error, diagnostic: args.diagnostic },
    });
    return null;
  },
});
