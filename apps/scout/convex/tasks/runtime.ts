"use node";

import { v } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { action } from "../functions";
import { command } from "./model";
import * as agentsApi from "./agentsApi";
import * as convexAgent from "./convexAgent";
import { closeBrowser } from "./execution";
import { endResearch } from "./siteResearch";
import { failTaskOnCreditError } from "./creditUsage";
import { creditFailure } from "../../shared/creditFailure";
import { diagnoseTaskFailure, logTaskFailure } from "./providerFailure";
import type { TaskFailureDiagnostic } from "../../shared/taskFailure";

type RuntimeSession = FunctionReturnType<typeof internal.tasks.sessions.cleanupResources>;
async function captureRuntimeFailure(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  session: RuntimeSession | null,
  operation: TaskFailureDiagnostic["operation"],
  error: unknown,
): Promise<never> {
  if (creditFailure(error)) return failTaskOnCreditError(ctx, sessionId, error);

  const current = session
    ? await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId }).catch(() => null)
    : null;
  const matching = current && (current.workflowId ?? null) === (session?.workflowId ?? null);
  const diagnostic = diagnoseTaskFailure(error, operation, session?.engine ?? null);
  logTaskFailure({
    sessionId,
    workflowId: session?.workflowId ?? null,
    providerSessionId: matching ? (current.providerId ?? null) : (session?.providerId ?? null),
    engine: matching ? current.engine : (session?.engine ?? null),
    diagnostic,
    deliveryStatus: matching ? (current.pendingMessage?.status ?? null) : null,
  });
  if (session) {
    try {
      await ctx.runMutation(internal.tasks.failure.record, {
        sessionId,
        workflowId: session.workflowId ?? null,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        diagnostic,
      });
    } catch {
      console.error("Task failure capture failed", {
        sessionId,
        workflowId: session.workflowId ?? null,
        operation,
      });
    }
  }
  throw error;
}

export const begin = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), command },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    let session: RuntimeSession | null = null;
    try {
      session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, {
        sessionId: args.sessionId,
      });
      if (session.state.kind !== "stopped" && session.billingEnabled)
        await ctx.runMutation(internal.credits.checkBalance, { sessionId: args.sessionId });
      switch (session.engine) {
        case "agents_api":
          return await agentsApi.begin(ctx, args);
        case "convex_agent":
          return await convexAgent.begin(ctx, args);
      }
    } catch (error) {
      return captureRuntimeFailure(ctx, args.sessionId, session, args.command.kind, error);
    }
  },
});

export const advance = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    let session: RuntimeSession | null = null;
    try {
      session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
      let continues: boolean;
      switch (session.engine) {
        case "agents_api":
          continues = await agentsApi.advance(ctx, args);
          break;
        case "convex_agent":
          continues = await convexAgent.advance(ctx, args);
          break;
      }
      return continues;
    } catch (error) {
      return captureRuntimeFailure(ctx, args.sessionId, session, "advance", error);
    }
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
    return null;
  },
});

export const cleanup = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, args);
    try {
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
      return null;
    } catch (error) {
      logTaskFailure({
        sessionId: args.sessionId,
        workflowId: session.workflowId ?? null,
        providerSessionId: session.providerId ?? null,
        engine: session.engine,
        diagnostic: diagnoseTaskFailure(error, "cleanup", session.engine),
        deliveryStatus: session.pendingMessage?.status ?? null,
      });
      throw error;
    }
  },
});
