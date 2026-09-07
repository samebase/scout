import { tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";

const playStep = z.enum(["research", "account_setup", "play"]);

export const playStepValidator = v.union(...playStep.options.map(v.literal));
export const playContextValidator = v.object({ step: v.union(playStepValidator, v.null()) });

export function playInstructions(play: Doc<"scoutChats">["play"]) {
  if (!play) return "";
  return `This is Scout Play. Help the user discover, prepare for, and play games. If a request is unrelated, briefly explain what you can help with here. Let the user's request determine the work: research and account setup are only needed when they help that request. Use existing skills and accounts as appropriate.
Call set_activity_step when your activity changes to research, account_setup, or play. These are user-visible activities, not a mandatory sequence or proof of completion. Current activity: ${play.step ?? "not yet selected"}.
Keep the user involved with brief, natural commentary about meaningful observations, choices, and results. Use normal assistant messages for this commentary, without code, tool arguments, or a detailed internal deliberation. Continue the task after an update.`;
}

export function createPlayTools(setStep: (step: z.infer<typeof playStep>) => Promise<void>) {
  return {
    set_activity_step: tool({
      description:
        "Update the activity shown to the user when you start researching a game, setting up account access, or playing. Skip activities that aren't needed and continue the task after updating.",
      inputSchema: z.object({ step: playStep }).strict(),
      execute: async ({ step }) => {
        await setStep(step);
        return { step };
      },
    }),
  };
}
