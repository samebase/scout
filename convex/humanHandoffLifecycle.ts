import { v } from "convex/values";
import { internal } from "./_generated/api";
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
    const evidence = await step.runAction(internal.humanHandoffBrowser.finishBrowserSession, {
      sessionId: args.sessionId,
      captureEvidence: outcome.kind === "continued",
    });
    if (outcome.kind === "continued") {
      await step.runMutation(internal.scout.chats.resumeHumanHandoff, {
        sessionId: args.sessionId,
        evidence,
      });
    }
    return null;
  });
