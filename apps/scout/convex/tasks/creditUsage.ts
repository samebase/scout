import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { costMicrodollars, creditsEnabled } from "../creditPolicy";

export async function recordTaskCreditUsage(ctx: ActionCtx, sessionId: Id<"agentsApiSessions">) {
  if (!creditsEnabled()) return true;
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (usage.webSearchCalls === null)
    throw new Error("Hosted web search usage exceeds the billing limit");
  return await ctx.runMutation(internal.credits.recordSessionUsage, {
    sessionId,
    modelCostMicrodollars: costMicrodollars(usage.modelCostUsd ?? 0),
    webSearchCalls: usage.webSearchCalls,
  });
}
