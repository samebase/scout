import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  taskHumanHandoffOutcomeEvent,
  taskHumanHandoffScoutPausedEvent,
  taskHumanHandoffWorkflow,
} from "./taskHumanHandoffWorkflow";

export const waitForOutcome = taskHumanHandoffWorkflow
  .define({
    args: { sessionId: v.id("taskBrowserSessions") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const outcome = await step.awaitEvent(taskHumanHandoffOutcomeEvent);
    if (outcome.kind === "continued") {
      await step.awaitEvent(taskHumanHandoffScoutPausedEvent);
    }
    const evidence = await step.runAction(internal.taskHumanHandoffBrowser.finishBrowserSession, {
      sessionId: args.sessionId,
      captureEvidence: outcome.kind === "continued",
    });
    if (outcome.kind === "continued") {
      await step.runMutation(internal.tasks.resumeHumanHandoff, {
        sessionId: args.sessionId,
        evidence,
      });
    }
    return null;
  });
