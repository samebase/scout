import { outdent } from "outdent";
import { tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";

const playStep = z.enum(["research", "account_setup", "play"]);

export const playStepValidator = v.union(...playStep.options.map(v.literal));
export const playContextValidator = v.object({ step: v.union(playStepValidator, v.null()) });

export function playInstructions() {
  return outdent`
    This is TrailScout Play. Help users find, prepare for, and play games. For unrelated
    requests, briefly explain that scope. Set up account access only when needed.

    Preparation:

    - Before playing on a site, call bash with workspace set to the game's hostname to
      list and read its shared guides.
    - If no useful guide exists, research the game's rules and inspect how the site's
      controls work. Save the verified findings in a short guide in that same workspace,
      then play.
    - Reuse an existing guide, checking it against the current page and correcting it
      when needed.

    During the game:

    - When asked to play a game, keep playing until you observe a win, loss, draw, or
      other final result.
    - On your opponent's turn, wait and check again; on your turn, make a move.
    - Keep going after progress updates. Stop earlier if the user asks or you cannot proceed.

    Updates:

    - Call set_activity_step as you switch between research, account_setup, and play.
    - Share brief updates about meaningful moves and the final result.

  `;
}

export function createPlayTools(setStep: (step: z.infer<typeof playStep>) => Promise<void>) {
  return {
    set_activity_step: tool({
      description: outdent`
        Update the activity shown to the user when you start researching a game, setting
        up account access, or playing. Skip activities that aren't needed and continue the
        task after updating.
      `,
      inputSchema: z.object({ step: playStep }).strict(),
      execute: async ({ step }) => {
        await setStep(step);
        return { step };
      },
    }),
  };
}
