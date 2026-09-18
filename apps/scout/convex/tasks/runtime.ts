"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { action } from "../functions";
import { command } from "./model";
import * as agentsApi from "./agentsApi";
import * as convexAgent from "./convexAgent";
import { closeBrowser } from "./execution";
import { endResearch } from "./siteResearch";
import { recordTaskCreditUsage, releaseTaskCreditHold } from "./creditUsage";
import { insufficientCredits } from "../creditLedger";

async function finishCreditSettlement(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  attempt: number,
) {
  await recordTaskCreditUsage(ctx, sessionId);
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (!usage.admissionReservationId) return;
  const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId });
  if (
    (session.engine === "agents_api" && !session.providerId) ||
    (usage.modelCostUsd !== null && !usage.modelUsageIncomplete)
  ) {
    await releaseTaskCreditHold(ctx, usage.admissionReservationId);
    return;
  }
  if (attempt < 3) {
    await ctx.scheduler.runAfter(30_000 * attempt, internal.tasks.runtime.settleCredits, {
      sessionId,
      attempt: attempt + 1,
    });
    return;
  }
  await ctx.runMutation(internal.credits.unresolved, {
    reservationId: usage.admissionReservationId,
    reason: "AI provider usage remained unavailable after three settlement checks",
  });
  console.error("AI usage unavailable after settlement checks", { sessionId });
}

export const settleCredits = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { sessionId, attempt }): Promise<null> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId });
    if (!session.creditAdmissionReservationId) return null;
    if (session.providerId) {
      try {
        switch (session.engine) {
          case "agents_api":
            await agentsApi.refreshExecution(ctx, session);
            break;
          case "convex_agent":
            await convexAgent.refreshExecution(ctx, session);
            break;
        }
      } catch (error) {
        if (attempt < 3) {
          await ctx.scheduler.runAfter(30_000 * attempt, internal.tasks.runtime.settleCredits, {
            sessionId,
            attempt: attempt + 1,
          });
        } else {
          await ctx.runMutation(internal.credits.unresolved, {
            reservationId: session.creditAdmissionReservationId,
            reason: "AI provider usage could not be retrieved after three settlement checks",
          });
        }
        console.error("AI usage refresh failed", { sessionId, attempt, error });
        return null;
      }
    }
    await finishCreditSettlement(ctx, sessionId, attempt);
    return null;
  },
});

export const begin = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), command },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, {
      sessionId: args.sessionId,
    });
    if (session.state.kind !== "stopped" && !(await recordTaskCreditUsage(ctx, args.sessionId)))
      throw insufficientCredits();
    switch (session.engine) {
      case "agents_api":
        return agentsApi.begin(ctx, args);
      case "convex_agent":
        return convexAgent.begin(ctx, args);
    }
  },
});

export const advance = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
    let continues: boolean;
    switch (session.engine) {
      case "agents_api":
        continues = await agentsApi.advance(ctx, args);
        break;
      case "convex_agent":
        continues = await convexAgent.advance(ctx, args);
        break;
    }
    const expectModelUsage = continues && session.engine === "convex_agent";
    const canContinue = await recordTaskCreditUsage(ctx, args.sessionId, expectModelUsage);
    if (continues && !canContinue) throw insufficientCredits();
    return continues;
  },
});

export const refresh = action({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
    if (session.active) throw new Error("The running session is already being refreshed");
    switch (session.engine) {
      case "agents_api":
        await agentsApi.refreshExecution(ctx, session);
        break;
      case "convex_agent":
        await convexAgent.refreshExecution(ctx, session);
        break;
    }
    await finishCreditSettlement(ctx, session._id, 1);
    return null;
  },
});

export const cleanup = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
    const research = await ctx.runQuery(internal.tasks.siteResearchRecords.get, args);
    if (research?.state.kind === "running" || research?.state.kind === "waiting") {
      await endResearch(
        ctx,
        research,
        session.state.kind === "failed"
          ? { kind: "failed", finishedAt: Date.now(), error: session.state.error }
          : { kind: "cancelled", finishedAt: Date.now() },
      );
    }
    try {
      switch (session.engine) {
        case "agents_api":
          await agentsApi.cancelExecution(ctx, session);
          break;
        case "convex_agent":
          await convexAgent.cancelExecution(ctx, session);
          break;
      }
    } finally {
      const current = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
      await closeBrowser(ctx, current);
    }
    await ctx.runMutation(internal.tasks.sessions.update, {
      sessionId: session._id,
      active: false,
    });
    switch (session.engine) {
      case "agents_api":
        await agentsApi.refreshExecution(ctx, session);
        break;
      case "convex_agent":
        await convexAgent.refreshExecution(ctx, session);
        break;
    }
    await finishCreditSettlement(ctx, session._id, 1);
    return null;
  },
});
