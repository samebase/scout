import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { requestCheckFinishedState, requestCheckRecord } from "./requestCheckModel";

export function getRequestCheck(ctx: Pick<QueryCtx, "db">, sessionId: Id<"agentsApiSessions">) {
  return ctx.db
    .query("agentsApiRequestChecks")
    .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
    .unique();
}

export const get = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: requestCheckRecord,
  handler: async (ctx, { sessionId }) => {
    const check = await getRequestCheck(ctx, sessionId);
    if (!check) throw new Error("Request check not found");
    return { sessionId, model: check.model, prompt: check.prompt, state: check.state };
  },
});

export const start = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), request: v.string(), startedAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, ...details }) => {
    const session = await ctx.db.get(sessionId);
    const check = await getRequestCheck(ctx, sessionId);
    if (!session || !check) throw new Error("Request check not found");
    if (session.state.kind === "stopped") {
      await ctx.db.patch(check._id, { state: { kind: "cancelled" } });
      await ctx.db.patch(sessionId, { active: false });
      return false;
    }
    if (check.state.kind !== "pending") throw new Error("Request check already started");
    await ctx.db.patch(check._id, { state: { kind: "running", ...details } });
    return true;
  },
});

export const finish = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), state: requestCheckFinishedState },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, state }) => {
    const session = await ctx.db.get(sessionId);
    const check = await getRequestCheck(ctx, sessionId);
    if (!session || !check) throw new Error("Request check not found");
    if (check.state.kind !== "running") throw new Error("Request check is not running");
    await ctx.db.patch(check._id, { state });
    if (state.kind === "completed") await ctx.db.patch(sessionId, { title: state.result.title });
    if (session.state.kind === "stopped") {
      await ctx.db.patch(sessionId, { active: false });
      return false;
    }
    const error =
      state.kind === "failed"
        ? state.error
        : state.result.decision.kind === "rejected"
          ? state.result.decision.reason
          : null;
    if (error !== null) {
      await ctx.db.patch(sessionId, {
        state: {
          kind: "failed",
          error,
        },
        active: false,
      });
      return false;
    }
    return true;
  },
});
