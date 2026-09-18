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
import { costMicrodollars } from "../creditPolicy";

async function finishCreditSettlement(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  reservationId: Id<"creditReservations">,
  attempt: number,
) {
  const reservation = await ctx.runQuery(internal.credits.operation, { reservationId });
  if (
    !reservation ||
    reservation.sessionId !== sessionId ||
    reservation.source.kind !== "admission_hold"
  )
    throw new Error("Credit admission hold is missing or belongs to another task");
  if (reservation.state.kind === "released" || reservation.state.kind === "settled") return;
  const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId });
  if (session.creditAdmissionReservationId !== reservationId) {
    await ctx.runMutation(internal.credits.unresolved, {
      reservationId,
      reason: "Credit admission changed before the prior turn was settled",
    });
    return;
  }
  await recordTaskCreditUsage(ctx, sessionId);
  if (session.active) return;
  const usage = await ctx.runQuery(internal.tasks.sessions.creditUsage, { sessionId });
  if (!session.creditModelWorkStarted) {
    await releaseTaskCreditHold(ctx, reservationId);
    return;
  }
  if (session.engine === "agents_api") {
    const modelCostUsd = await agentsApi.reportedModelCost(session);
    if (modelCostUsd !== null) {
      if (usage.webSearchCalls === null)
        throw new Error("Hosted web search usage exceeds the billing limit");
      await ctx.runMutation(internal.credits.recordSessionUsage, {
        sessionId,
        modelCostMicrodollars: costMicrodollars(modelCostUsd),
        budgetModelCostMicrodollars: costMicrodollars(modelCostUsd),
        webSearchCalls: usage.webSearchCalls,
      });
      await releaseTaskCreditHold(ctx, reservationId);
      return;
    }
  } else if (
    session.creditAdmissionTurnUsageRecorded === true &&
    usage.modelCostUsd !== null &&
    !usage.modelUsageIncomplete
  ) {
    await releaseTaskCreditHold(ctx, reservationId);
    return;
  }
  if (attempt < 3) {
    await ctx.scheduler.runAfter(30_000 * attempt, internal.tasks.runtime.settleCredits, {
      sessionId,
      reservationId,
      attempt: attempt + 1,
    });
    return;
  }
  await ctx.runMutation(internal.credits.unresolved, {
    reservationId,
    reason: "AI provider usage remained unavailable after three settlement checks",
  });
  console.error("AI usage unavailable after settlement checks", { sessionId });
}

export const settleCredits = internalAction({
  args: {
    sessionId: v.id("agentsApiSessions"),
    reservationId: v.id("creditReservations"),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, reservationId, attempt }): Promise<null> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId });
    const reservation = await ctx.runQuery(internal.credits.operation, { reservationId });
    if (
      !reservation ||
      reservation.state.kind === "released" ||
      reservation.state.kind === "settled"
    )
      return null;
    if (session.creditAdmissionReservationId !== reservationId) {
      await ctx.runMutation(internal.credits.unresolved, {
        reservationId,
        reason: "Credit admission changed before the prior turn was settled",
      });
      return null;
    }
    if (session.active && session.state.kind !== "waiting") return null;
    try {
      if (session.providerId) {
        switch (session.engine) {
          case "agents_api":
            await agentsApi.refreshExecution(ctx, session);
            break;
          case "convex_agent":
            await convexAgent.refreshExecution(ctx, session);
            break;
        }
      }
      await finishCreditSettlement(ctx, sessionId, reservationId, attempt);
    } catch (error) {
      if (attempt < 3) {
        await ctx.scheduler.runAfter(30_000 * attempt, internal.tasks.runtime.settleCredits, {
          sessionId,
          reservationId,
          attempt: attempt + 1,
        });
      } else {
        await ctx.runMutation(internal.credits.unresolved, {
          reservationId,
          reason: "AI provider usage could not be settled after three checks",
        });
      }
      console.error("AI usage settlement failed", { sessionId, attempt, error });
    }
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
    if (session.state.kind !== "stopped" && session.creditAdmissionReservationId)
      await ctx.runMutation(internal.tasks.sessions.markModelWorkStarted, {
        sessionId: args.sessionId,
        reservationId: session.creditAdmissionReservationId,
      });
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
    if (session.active && session.state.kind !== "waiting")
      throw new Error("The running session is already being refreshed");
    switch (session.engine) {
      case "agents_api":
        await agentsApi.refreshExecution(ctx, session);
        break;
      case "convex_agent":
        await convexAgent.refreshExecution(ctx, session);
        break;
    }
    if (session.creditAdmissionReservationId && !session.active)
      await ctx.scheduler.runAfter(0, internal.tasks.runtime.settleCredits, {
        sessionId: session._id,
        reservationId: session.creditAdmissionReservationId,
        attempt: 1,
      });
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
    try {
      switch (session.engine) {
        case "agents_api":
          await agentsApi.refreshExecution(ctx, session);
          break;
        case "convex_agent":
          await convexAgent.refreshExecution(ctx, session);
          break;
      }
    } finally {
      if (session.creditAdmissionReservationId)
        await ctx.scheduler.runAfter(0, internal.tasks.runtime.settleCredits, {
          sessionId: session._id,
          reservationId: session.creditAdmissionReservationId,
          attempt: 1,
        });
    }
    return null;
  },
});
