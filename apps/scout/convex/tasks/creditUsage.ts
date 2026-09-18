import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { costMicrodollars, creditsEnabled } from "../creditPolicy";

export async function recordTaskCreditUsage(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  expectModelUsage = false,
) {
  if (!creditsEnabled()) return true;
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (usage.webSearchCalls === null)
    throw new Error("Hosted web search usage exceeds the billing limit");
  const canContinue = await ctx.runMutation(internal.credits.recordSessionUsage, {
    sessionId,
    modelCostMicrodollars: costMicrodollars(usage.modelCostUsd ?? 0),
    webSearchCalls: usage.webSearchCalls,
  });
  if (usage.modelUsageIncomplete || (expectModelUsage && usage.modelCostUsd === null)) {
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
  if (reservation.state.kind === "pending")
    await ctx.runMutation(internal.credits.release, {
      reservationId,
      reason: "Turn completed; usage recorded separately",
    });
}
