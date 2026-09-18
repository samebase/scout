import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { costMicrodollars, creditsEnabled } from "../creditPolicy";

export async function recordTaskCreditUsage(ctx: ActionCtx, sessionId: Id<"agentsApiSessions">) {
  if (!creditsEnabled()) return;
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (usage.modelCostUsd === null || usage.webSearchCalls === null) return;
  await ctx.runMutation(internal.credits.recordSessionUsage, {
    sessionId,
    modelCostMicrodollars: costMicrodollars(usage.modelCostUsd),
    webSearchCalls: usage.webSearchCalls,
  });
}
