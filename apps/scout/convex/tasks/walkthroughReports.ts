import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { query } from "../functions";
import { assertCreditAdmission, recordCreditUsage } from "../creditLedger";
import { costMicrodollars } from "../creditPolicy";
import { convexUsage } from "./convexAgentModel";
import { walkthroughContent } from "./screenshotModel";
import { saveWalkthrough, walkthroughInput } from "./walkthrough";
import { walkthroughReporting } from "./walkthroughReportModel";

const identity = { sessionId: v.id("agentsApiSessions"), callId: v.string() };
const MAX_REPORTS = 100;

export async function reportingCalls(
  ctx: Pick<QueryCtx, "db">,
  sessionId: Id<"agentsApiSessions">,
) {
  const calls = await ctx.db
    .query("agentsApiCalls")
    .withIndex("by_session_id_and_reporting_started_at", (q) =>
      q.eq("sessionId", sessionId).gt("reporting.startedAt", 0),
    )
    .take(MAX_REPORTS + 1);
  if (calls.length > MAX_REPORTS) throw new Error("Task exceeds the 100 walkthrough updates limit");
  return calls;
}

function findCall(
  ctx: Pick<QueryCtx, "db">,
  args: { sessionId: Id<"agentsApiSessions">; callId: string },
) {
  return ctx.db
    .query("agentsApiCalls")
    .withIndex("by_session_id_and_call_id", (q) =>
      q.eq("sessionId", args.sessionId).eq("callId", args.callId),
    )
    .unique();
}

export const list = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.array(
    v.object({
      callId: v.string(),
      startedAt: v.number(),
      model: v.string(),
      state: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    }),
  ),
  handler: async (ctx, { sessionId }) =>
    (await reportingCalls(ctx, sessionId)).flatMap((call) =>
      call.reporting
        ? [
            {
              callId: call.callId,
              startedAt: call.reporting.startedAt,
              model: call.reporting.model,
              state: call.reporting.state.kind,
            },
          ]
        : [],
    ),
});

export const inspect = query({
  access: "access_lab",
  args: identity,
  returns: v.union(walkthroughReporting, v.null()),
  handler: async (ctx, args) => (await findCall(ctx, args))?.reporting ?? null,
});

export const context = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.object({
    previous: v.union(walkthroughContent, v.null()),
    requests: v.array(v.string()),
  }),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Task not found");
    const requests = await ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_kind", (q) => q.eq("sessionId", sessionId).eq("kind", "user"))
      .take(101);
    if (requests.length > 100)
      throw new Error("Walkthrough reporting supports up to 100 user messages per task");
    requests.sort((a, b) => a.sequence - b.sequence);
    return { previous: session.walkthrough ?? null, requests: requests.map((item) => item.text) };
  },
});

export const start = internalMutation({
  args: { ...identity, model: v.string(), request: v.string(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { sessionId, callId, ...details }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.state.kind !== "running") throw new Error("Task is no longer running");
    const call = await findCall(ctx, { sessionId, callId });
    if (!call || call.result.kind !== "running")
      throw new Error("Walkthrough tool call is not running");
    if (call.reporting) throw new Error("Walkthrough reporting has already started for this call");
    if ((await reportingCalls(ctx, sessionId)).length >= MAX_REPORTS)
      throw new Error("Task reached the 100 walkthrough updates limit");
    if (session.billingEnabled) await assertCreditAdmission(ctx, session.userId);
    await ctx.db.patch(call._id, {
      reporting: {
        ...details,
        billable: session.billingEnabled ?? false,
        state: { kind: "running" },
      },
    });
    return null;
  },
});

export const finish = internalMutation({
  args: {
    ...identity,
    response: v.union(v.string(), v.null()),
    usage: v.union(convexUsage, v.null()),
    outcome: v.union(
      v.object({ kind: v.literal("completed"), report: walkthroughInput.omit("sessionId") }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await findCall(ctx, args);
    if (!call?.reporting) throw new Error("Walkthrough reporting was not started");
    if (call.reporting.state.kind !== "running") return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Task not found");
    const details = { finishedAt: Date.now(), response: args.response, usage: args.usage };
    let state;
    if (args.outcome.kind === "completed") {
      if (args.response === null) throw new Error("Walkthrough reporting response is missing");
      const report = await saveWalkthrough(ctx, {
        sessionId: args.sessionId,
        ...args.outcome.report,
      });
      state = { ...details, kind: "completed" as const, response: args.response, report };
    } else {
      state = { ...details, kind: "failed" as const, error: args.outcome.error };
    }
    if (call.reporting.billable && args.usage?.costUsd != null)
      await recordCreditUsage(ctx, {
        userId: session.userId,
        sessionId: session._id,
        sourceKey: `walkthrough:${session._id}:${args.callId}`,
        kind: "model",
        totalCostMicrodollars: costMicrodollars(args.usage.costUsd),
      });
    await ctx.db.patch(call._id, { reporting: { ...call.reporting, state } });
    return null;
  },
});
