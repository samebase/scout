import { WorkflowManager, vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { command } from "./model";
import { getResearch } from "./siteResearchRecords";

export const workflow = new WorkflowManager(components.workflow);

export const run = workflow
  .define({
    args: { sessionId: v.id("agentsApiSessions"), command },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    if (
      (args.command.kind === "start" || args.command.kind === "resume") &&
      !(await step.runAction(
        internal.agentsApi.requestCheck.run,
        { checkId: args.command.checkId },
        { retry: false },
      ))
    )
      return null;
    if (args.command.kind === "start") {
      await step.runAction(
        internal.agentsApi.siteResearch.run,
        {
          sessionId: args.sessionId,
          prompt: args.command.prompt,
        },
        { retry: false },
      );
    }
    if (!(await step.runAction(internal.agentsApi.runtime.begin, args, { retry: false })))
      return null;
    while (
      await step.runAction(
        internal.agentsApi.runtime.advance,
        { sessionId: args.sessionId },
        {
          retry: false,
          runAfter: 2_000,
        },
      )
    ) {
      /* OpenAI runs the agent; Convex services its requested functions. */
    }
    return null;
  });

export const onComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ sessionId: v.id("agentsApiSessions") }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.context.sessionId);
    if (session?.workflowId === args.workflowId && args.result.kind !== "success") {
      const research = await getResearch(ctx, session._id);
      if (research?.state.kind === "running") {
        await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
          researchId: research._id,
          state:
            args.result.kind === "failed"
              ? { kind: "failed", finishedAt: Date.now(), error: args.result.error }
              : { kind: "cancelled", finishedAt: Date.now() },
        });
      }
      if (session.state.kind !== "stopped") {
        await ctx.db.patch(session._id, {
          state: {
            kind: "failed",
            error: args.result.kind === "failed" ? args.result.error : "Execution was cancelled",
          },
        });
      }
      await ctx.runMutation(internal.agentsApi.sessions.scheduleCleanup, {
        sessionId: session._id,
      });
    }
    await workflow.cleanup(ctx, args.workflowId);
    return null;
  },
});
