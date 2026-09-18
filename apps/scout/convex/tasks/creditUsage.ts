import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { costMicrodollars } from "../creditPolicy";
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

export async function recordTaskCreditUsage(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  expectModelUsage = false,
) {
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (!usage.admissionReservationId) return true;
  if (usage.webSearchCalls === null)
    throw new Error("Hosted web search usage exceeds the billing limit");
  if (usage.modelBudgetUsd === null)
    throw new Error("AI model usage cannot be priced for the task budget");
  const canContinue = await ctx.runMutation(internal.credits.recordSessionUsage, {
    sessionId,
    reservationId: usage.admissionReservationId,
    modelCostMicrodollars: costMicrodollars(usage.modelCostUsd ?? 0),
    budgetModelCostMicrodollars: costMicrodollars(usage.modelBudgetUsd),
    webSearchCalls: usage.webSearchCalls,
  });
  if (expectModelUsage && (usage.modelUsageIncomplete || usage.modelCostUsd === null)) {
    if (usage.admissionReservationId)
      await ctx.runMutation(internal.credits.unresolved, {
        reservationId: usage.admissionReservationId,
        reason: "AI provider work completed without a complete usage report",
      });
    throw new Error("Scout could not confirm AI usage. The credit hold needs review.");
  }
  return canContinue;
}

export async function releaseTaskCreditHold(
  ctx: ActionCtx,
  reservationId: Id<"creditReservations"> | undefined,
) {
  if (!reservationId) return;
  const reservation = await ctx.runQuery(internal.credits.operation, { reservationId });
  if (!reservation) throw new Error("Credit admission hold is missing");
  if (reservation.state.kind === "pending" || reservation.state.kind === "unresolved")
    await ctx.runMutation(internal.credits.release, {
      reservationId,
      reason: "Turn completed; usage recorded separately",
    });
}
