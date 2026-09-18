import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { creditFailure } from "../../shared/creditFailure";

export async function failTaskOnCreditError(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  error: unknown,
): Promise<never> {
  const failure = creditFailure(error);
  // Workflow stores failed actions as strings, so preserve the code before returning to it.
  if (failure)
    await ctx.runMutation(internal.tasks.lifecycle.failForCredits, { sessionId, ...failure });
  throw error;
}
