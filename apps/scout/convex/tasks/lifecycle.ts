import { WorkflowManager, vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { command } from "./model";
import { creditFailureCodeValidator } from "../creditsModel";

export const workflow = new WorkflowManager(components.workflow);

export const failForCredits = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    code: creditFailureCodeValidator,
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, code, message }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Task session is missing");
    if (!session.active || session.state.kind === "stopped") return null;
    await ctx.db.patch(sessionId, {
      state: { kind: "failed", error: message, creditFailureCode: code },
    });
    return null;
  },
});

export const run = workflow
  .define({
    args: { sessionId: v.id("agentsApiSessions"), command },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    if (
      (args.command.kind === "start" || args.command.kind === "resume") &&
      !(await step.runAction(
        internal.tasks.requestCheck.run,
        { checkId: args.command.checkId },
        { retry: false },
      ))
    )
      return null;
    if (args.command.kind === "start") {
      const researching = await step.runAction(
        internal.tasks.siteResearch.run,
        {
          sessionId: args.sessionId,
          prompt: args.command.prompt,
        },
        { retry: false },
      );
      if (researching) {
        while (
          await step.runAction(
            internal.tasks.siteResearch.advance,
            { sessionId: args.sessionId },
            { retry: false, runAfter: 5_000 },
          )
        ) {
          /* Firecrawl researches the site; the workflow polls without holding an action open. */
        }
      }
    }
    if (!(await step.runAction(internal.tasks.runtime.begin, args, { retry: false }))) return null;
    while (
      await step.runAction(
        internal.tasks.runtime.advance,
        { sessionId: args.sessionId },
        {
          retry: false,
          runAfter: 2_000,
        },
      )
    ) {
      /* Each driver advances through the same durable workflow. */
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
      if (session.state.kind !== "stopped") {
        await ctx.db.patch(session._id, {
          state:
            session.state.kind === "failed"
              ? session.state
              : {
                  kind: "failed",
                  error:
                    args.result.kind === "failed" ? args.result.error : "Execution was cancelled",
                },
        });
      }
      await ctx.runMutation(internal.tasks.sessions.scheduleCleanup, {
        sessionId: session._id,
      });
    }
    await workflow.cleanup(ctx, args.workflowId);
    return null;
  },
});
