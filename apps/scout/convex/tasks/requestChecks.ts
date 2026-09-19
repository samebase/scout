import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { costMicrodollars, creditsEnabled } from "../creditPolicy";
import { assertCreditAdmission, recordCreditUsage } from "../creditLedger";
import { query } from "../functions";
import schema from "../schema";
import { syncChatSite } from "../scout/siteListings";
import { estimateAgentsApiCost } from "./cost";
import { handoffEvidenceValidator } from "./handoffEvidenceModel";
import { requestCheckCreditSourceKey } from "./requestCheckCredits";
import { MAX_SESSION_CHECKS, requestCheckFinishedState } from "./requestCheckModel";
import { handoffContext } from "./model";
import { internal } from "../_generated/api";

export function getInitialCheck(ctx: Pick<QueryCtx, "db">, sessionId: Id<"agentsApiSessions">) {
  return ctx.db
    .query("agentsApiRequestChecks")
    .withIndex("by_session_id_and_kind", (q) => q.eq("sessionId", sessionId).eq("kind", "initial"))
    .unique();
}

export function listChecks(ctx: Pick<QueryCtx, "db">, sessionId: Id<"agentsApiSessions">) {
  return ctx.db
    .query("agentsApiRequestChecks")
    .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
    .order("asc")
    .take(MAX_SESSION_CHECKS);
}

export function checkCost(check: Pick<Doc<"agentsApiRequestChecks">, "model" | "state">) {
  if (check.state.kind === "pending" || check.state.kind === "cancelled") return 0;
  const call =
    check.state.kind === "completed" || check.state.kind === "failed" ? check.state.call : null;
  if (check.state.kind === "failed" && call === null) return 0;
  return estimateAgentsApiCost({
    model: check.model,
    modelUsageIncomplete: false,
    usage: call?.usage ?? null,
    webSearchCalls: 0,
    browsers: [],
    firecrawlUsdPerCredit: null,
    now: 0,
  }).modelEstimateUsd;
}

export function summarizeCheck(check: Doc<"agentsApiRequestChecks">) {
  return {
    _id: check._id,
    kind: check.kind,
    status: check.state.kind === "completed" ? check.state.result.decision.kind : check.state.kind,
    cost: checkCost(check),
  };
}

export async function currentCheckMessage(
  ctx: Pick<QueryCtx, "db">,
  session: Doc<"agentsApiSessions">,
) {
  const check =
    session.state.kind === "waiting"
      ? await ctx.db
          .query("agentsApiRequestChecks")
          .withIndex("by_session_id_and_kind", (q) =>
            q.eq("sessionId", session._id).eq("kind", "resume"),
          )
          .order("desc")
          .first()
      : session.state.kind === "failed"
        ? await getInitialCheck(ctx, session._id)
        : null;
  if (!check) return null;
  if (
    check.kind === "resume" &&
    (session.state.kind !== "waiting" ||
      check.handoff.callId !== session.state.callId ||
      check.handoff.turnId !== session.state.turnId)
  )
    return null;
  if (check.state.kind === "failed") return check.state.error;
  return check.state.kind === "completed" && check.state.result.decision.kind === "rejected"
    ? check.state.result.decision.reason
    : null;
}

export async function resumeAttempts(
  ctx: Pick<QueryCtx, "db">,
  sessionId: Id<"agentsApiSessions">,
) {
  const checks = await ctx.db
    .query("agentsApiRequestChecks")
    .withIndex("by_session_id_and_kind", (q) => q.eq("sessionId", sessionId).eq("kind", "resume"))
    .order("desc")
    .take(MAX_SESSION_CHECKS);
  return checks
    .map((check) => {
      switch (check.state.kind) {
        case "completed":
          return {
            id: check._id,
            finishedAt: check.state.finishedAt,
            outcome: check.state.result.decision,
          };
        case "failed":
          return {
            id: check._id,
            finishedAt: check.state.finishedAt,
            outcome: { kind: "failed" as const, error: check.state.error },
          };
        case "pending":
        case "running":
        case "cancelled":
          return null;
      }
    })
    .filter((check) => check !== null);
}

const checkDoc = schema.doc("agentsApiRequestChecks");
export const inspect = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions"), checkId: v.id("agentsApiRequestChecks") },
  returns: v.union(
    checkDoc.members[0].extend({ cost: v.union(v.number(), v.null()) }),
    checkDoc.members[1].extend({ cost: v.union(v.number(), v.null()) }),
  ),
  handler: async (ctx, { sessionId, checkId }) => {
    const check = await ctx.db.get(checkId);
    if (!check || check.sessionId !== sessionId) throw new Error("Check not found in this session");
    return { ...check, cost: checkCost(check) };
  },
});

export const get = internalQuery({
  args: { checkId: v.id("agentsApiRequestChecks") },
  returns: checkDoc,
  handler: async (ctx, { checkId }) => {
    const check = await ctx.db.get(checkId);
    if (!check) throw new Error("Check not found");
    return check;
  },
});

function matchesSession(check: Doc<"agentsApiRequestChecks">, session: Doc<"agentsApiSessions">) {
  if (!session.active) return false;
  return check.kind === "initial"
    ? session.state.kind === "starting"
    : session.state.kind === "checking" &&
        session.state.checkId === check._id &&
        session.browser?.providerSessionId === check.providerSessionId;
}

export const start = internalMutation({
  args: {
    checkId: v.id("agentsApiRequestChecks"),
    request: v.string(),
    startedAt: v.number(),
    evidence: v.union(handoffEvidenceValidator, v.null()),
  },
  returns: v.boolean(),
  handler: async (ctx, { checkId, evidence, ...details }) => {
    const check = await ctx.db.get(checkId);
    if (!check) throw new Error("Check not found");
    const session = await ctx.db.get(check.sessionId);
    if (!session) throw new Error("Session not found");
    if (check.state.kind !== "pending") return false;
    if (!matchesSession(check, session)) {
      await ctx.db.patch(checkId, { state: { kind: "cancelled" } });
      if (check.kind === "initial" && session.state.kind === "stopped" && !session.browser)
        await ctx.db.patch(session._id, { active: false });
      return false;
    }
    if (check.kind === "resume") {
      if (evidence === null) throw new Error("Resume check needs fresh browser evidence");
    } else if (evidence !== null) {
      throw new Error("Initial check cannot contain browser evidence");
    }
    const billable = creditsEnabled();
    if (billable) await assertCreditAdmission(ctx, session.userId);
    if (check.kind === "resume") {
      await ctx.db.patch(checkId, { evidence, state: { kind: "running", ...details, billable } });
    } else {
      await ctx.db.patch(checkId, { state: { kind: "running", ...details, billable } });
    }
    return true;
  },
});

export const finish = internalMutation({
  args: { checkId: v.id("agentsApiRequestChecks"), state: requestCheckFinishedState },
  returns: v.boolean(),
  handler: async (ctx, { checkId, state }) => {
    const check = await ctx.db.get(checkId);
    if (!check) throw new Error("Check not found");
    const session = await ctx.db.get(check.sessionId);
    if (!session) throw new Error("Session not found");
    if (
      check.state.kind !== "running" &&
      !(check.state.kind === "pending" && state.kind === "failed" && state.call === null)
    )
      throw new Error("Check is not running");
    if (state.kind === "completed" && state.result.kind !== check.kind)
      throw new Error("Check result kind does not match");
    if (check.state.kind === "running" && check.state.billable) {
      const measuredCost = checkCost({ model: check.model, state });
      if (state.call?.usage && measuredCost !== null)
        await recordCreditUsage(ctx, {
          userId: session.userId,
          sessionId: session._id,
          sourceKey: requestCheckCreditSourceKey(checkId),
          kind: "request_check",
          totalCostMicrodollars: costMicrodollars(measuredCost),
        });
    }
    if (state.kind === "failed") {
      await ctx.db.patch(checkId, { state });
    } else if (state.result.kind === "initial") {
      await ctx.db.patch(checkId, { state: { ...state, result: state.result } });
    } else {
      await ctx.db.patch(checkId, { state: { ...state, result: state.result } });
    }
    if (check.kind === "initial") {
      const chat = await ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (q) => q.eq("threadId", check.sessionId))
        .unique();
      if (chat) await syncChatSite(ctx, chat);
    }
    if (!matchesSession(check, session)) {
      if (check.kind === "initial" && session.state.kind === "stopped" && !session.browser)
        await ctx.db.patch(session._id, { active: false });
      return false;
    }
    const error =
      state.kind === "failed"
        ? state.error
        : state.result.decision.kind === "rejected"
          ? state.result.decision.reason
          : null;
    if (check.kind === "initial") {
      if (state.kind === "completed" && state.result.kind === "initial")
        await ctx.db.patch(session._id, { title: state.result.title });
      if (error !== null)
        await ctx.db.patch(session._id, { state: { kind: "failed", error }, active: false });
    } else if (error !== null) {
      await ctx.db.patch(session._id, { state: { kind: "waiting", ...check.handoff } });
      if (check.handoff.expiresAt !== undefined) {
        await ctx.scheduler.runAt(check.handoff.expiresAt, internal.tasks.sessions.expireHandoff, {
          sessionId: session._id,
          callId: check.handoff.callId,
          turnId: check.handoff.turnId,
          expiresAt: check.handoff.expiresAt,
        });
      }
    }
    console.info("Task request check finished", {
      sessionId: session._id,
      checkId,
      kind: check.kind,
      outcome: state.kind === "failed" ? "failed" : state.result.decision.kind,
    });
    return error === null;
  },
});

export const releaseHandoff = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), checkId: v.id("agentsApiRequestChecks") },
  returns: v.union(
    v.object({ handoff: handoffContext, evidence: handoffEvidenceValidator }),
    v.null(),
  ),
  handler: async (ctx, { sessionId, checkId }) => {
    const check = await ctx.db.get(checkId);
    const session = await ctx.db.get(sessionId);
    if (!check || !session || check.sessionId !== sessionId || check.kind !== "resume")
      throw new Error("Resume check not found");
    if (!matchesSession(check, session)) return null;
    if (
      check.state.kind !== "completed" ||
      check.state.result.decision.kind !== "approved" ||
      check.evidence === null
    )
      throw new Error("Resume check has not approved this handoff");
    await ctx.db.patch(sessionId, { state: { kind: "running" } });
    console.info("Task browser handoff released", {
      sessionId,
      checkId,
      callId: check.handoff.callId,
    });
    return { handoff: check.handoff, evidence: check.evidence };
  },
});
