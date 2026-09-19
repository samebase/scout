import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { vWorkflowId } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { mutation, query } from "../functions";
import { requireSessionPermission } from "./access";
import { scoutReservation } from "../scout/availability";
import { workflow } from "./lifecycle";
import {
  browserHandle,
  callResult,
  command,
  sessionItem,
  sessionState,
  sessionUsage,
  taskEngine,
} from "./model";
import type { Infer } from "convex/values";
import { omitNullish } from "../../shared/omitNullish";
import { MAX_BROWSER_SESSIONS_PER_THREAD } from "../scout/browserSessions";
import { browserSessionLifecycleValidator } from "../browserModel";
import { agentsApiCostValidator, estimateAgentsApiCost } from "./cost";
import {
  getInitialCheck,
  listChecks,
  summarizeCheck,
  currentCheckMessage,
  resumeAttempts,
} from "./requestChecks";
import { REQUEST_CHECK_MODEL, MAX_SESSION_CHECKS, checkSummary } from "./requestCheckModel";
import { getResearch, summarizeResearch } from "./siteResearchRecords";
import { researchSummary } from "./siteResearchModel";
import { agentsToolActivity, pairedAgentsOutput } from "../scout/toolActivityAgents";
import { toolActivityValidator } from "../../shared/toolActivity";
import schema from "../schema";
import { creditsEnabled } from "../creditPolicy";
import { assertCreditAdmission } from "../creditLedger";
import {
  FIRECRAWL_BROWSER_TTL_SECONDS,
  HANDOFF_EXPIRED_REASON,
  HANDOFF_RESPONSE_WINDOW_MS,
} from "../../shared/handoff";

async function requireSession(ctx: QueryCtx, sessionId: Id<"agentsApiSessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found");
  return { ...session, engine: session.engine ?? "agents_api" };
}

async function owned(ctx: QueryCtx, sessionId: Id<"agentsApiSessions">, userId: Id<"users">) {
  const session = await requireSession(ctx, sessionId);
  if (session.userId !== userId) throw new Error("Session not found");
  return session;
}

async function requireAvailableScout(ctx: QueryCtx, scoutId: Id<"scouts">) {
  const reservation = await scoutReservation(ctx, scoutId);
  if (!reservation) return;
  if (reservation.kind === "browser")
    throw new Error("Close this Scout's existing browser before starting another session");
  throw new Error("This Scout is already working");
}

async function scheduleSessionCleanup(ctx: MutationCtx, session: Doc<"agentsApiSessions">) {
  if (!session.active) return;
  if (
    session.state.kind !== "stopped" &&
    session.state.kind !== "failed" &&
    session.state.kind !== "waiting"
  ) {
    throw new Error("Stop the session before scheduling cleanup");
  }
  const job = session.cleanupJobId ? await ctx.db.system.get(session.cleanupJobId) : null;
  if (job?.state.kind === "pending" || job?.state.kind === "inProgress") return;
  const cleanupJobId = await ctx.scheduler.runAfter(0, internal.tasks.runtime.cleanup, {
    sessionId: session._id,
  });
  await ctx.db.patch(session._id, { cleanupJobId });
}

async function stopSession(
  ctx: MutationCtx,
  session: Doc<"agentsApiSessions">,
  state: Extract<Doc<"agentsApiSessions">["state"], { kind: "stopped" }>,
) {
  await ctx.db.patch(session._id, { state });
  if (
    session.active &&
    (session.state.kind === "waiting" ||
      session.state.kind === "checking" ||
      session.state.kind === "failed" ||
      session.cleanupJobId !== undefined)
  ) {
    await scheduleSessionCleanup(ctx, { ...session, state });
  }
}

async function browserHandoffDeadline(ctx: MutationCtx, session: Doc<"agentsApiSessions">) {
  if (!session.browser) throw new Error("Handoff browser is not available");
  const handle = session.browser;
  let browserExpiresAt = handle.providerExpiresAtMs;
  if (browserExpiresAt === undefined) {
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) =>
        q.eq("providerSessionId", handle.providerSessionId),
      )
      .unique();
    if (!browser || browser.agentsSessionId !== session._id)
      throw new Error("Handoff browser record is missing");
    // Before expiry was persisted, every browser was opened with this one-hour TTL.
    browserExpiresAt = browser.lifecycle.openedAtMs + FIRECRAWL_BROWSER_TTL_SECONDS * 1_000;
  }
  return Math.min(Date.now() + HANDOFF_RESPONSE_WINDOW_MS, browserExpiresAt);
}

export const expireHandoff = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    callId: v.string(),
    turnId: v.string(),
    expiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (
      !session?.active ||
      session.state.kind !== "waiting" ||
      session.state.callId !== args.callId ||
      session.state.turnId !== args.turnId ||
      session.state.expiresAt !== args.expiresAt ||
      Date.now() < args.expiresAt
    )
      return false;
    await stopSession(ctx, session, { kind: "stopped", reason: "handoff_expired" });
    console.info("Task browser handoff expired", {
      sessionId: session._id,
      callId: args.callId,
      turnId: args.turnId,
      expiresAt: args.expiresAt,
    });
    const call = await ctx.db
      .query("agentsApiCalls")
      .withIndex("by_session_id_and_call_id", (q) =>
        q.eq("sessionId", session._id).eq("callId", args.callId),
      )
      .unique();
    const result = { kind: "interrupted" as const, error: HANDOFF_EXPIRED_REASON };
    if (call) await ctx.db.patch(call._id, { result });
    else
      await ctx.db.insert("agentsApiCalls", {
        sessionId: session._id,
        callId: args.callId,
        result,
      });
    return true;
  },
});

// Explicit maintenance for pre-deadline handoffs; never scans or repairs unrelated tasks.
export const repairHandoffDeadlines = internalMutation({
  args: { sessionIds: v.array(v.id("agentsApiSessions")) },
  returns: v.array(v.object({ sessionId: v.id("agentsApiSessions"), expiresAt: v.number() })),
  handler: async (ctx, { sessionIds }) => {
    if (sessionIds.length > 50) throw new Error("Repair at most 50 handoffs per call");
    const repaired = [];
    for (const sessionId of sessionIds) {
      const session = await ctx.db.get(sessionId);
      if (
        !session?.active ||
        session.state.kind !== "waiting" ||
        session.state.expiresAt !== undefined
      )
        continue;
      const expiresAt = await browserHandoffDeadline(ctx, session);
      await ctx.db.patch(sessionId, { state: { ...session.state, expiresAt } });
      await ctx.scheduler.runAt(expiresAt, internal.tasks.sessions.expireHandoff, {
        sessionId,
        callId: session.state.callId,
        turnId: session.state.turnId,
        expiresAt,
      });
      repaired.push({ sessionId, expiresAt });
    }
    return repaired;
  },
});

async function startWorkflow(
  ctx: MutationCtx,
  sessionId: Id<"agentsApiSessions">,
  input: Infer<typeof command>,
) {
  const workflowId = await workflow.start(
    ctx,
    internal.tasks.lifecycle.run,
    {
      sessionId,
      command: input,
    },
    {
      startAsync: true,
      onComplete: internal.tasks.lifecycle.onComplete,
      context: { sessionId },
    },
  );
  const session = await requireSession(ctx, sessionId);
  if (input.kind === "resume" || input.kind === "observe") {
    if (session.billingEnabled) await assertCreditAdmission(ctx, session.userId);
    await ctx.db.patch(sessionId, { workflowId });
  } else {
    const billingEnabled = creditsEnabled();
    if (billingEnabled) await assertCreditAdmission(ctx, session.userId);
    await ctx.db.patch(sessionId, { workflowId, billingEnabled, modelTurnId: undefined });
  }
  if (input.kind === "send")
    await ctx.db.patch(sessionId, {
      pendingMessage: { message: input.message, workflowId, status: "queued" },
    });
}

export const list = query({
  access: "access_lab",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      _id: v.id("agentsApiSessions"),
      _creationTime: v.number(),
      title: v.string(),
      scoutName: v.string(),
      state: sessionState,
      checks: v.array(checkSummary),
      hasChat: v.boolean(),
      engine: taskEngine,
      research: v.union(researchSummary, v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("agentsApiSessions")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...sessions,
      page: await Promise.all(
        sessions.page.map(
          async ({ _id, _creationTime, title, scoutName, state, providerId, engine }) => {
            const checks = await listChecks(ctx, _id);
            const research = await getResearch(ctx, _id);
            return {
              _id,
              _creationTime,
              title,
              scoutName,
              state,
              checks: checks.map(summarizeCheck),
              hasChat: Boolean(providerId),
              engine: engine ?? "agents_api",
              research: research ? summarizeResearch(research) : null,
            };
          },
        ),
      ),
    };
  },
});

async function estimateSessionCost(ctx: QueryCtx, session: Doc<"agentsApiSessions">) {
  const [browsers, searches] = await Promise.all([
    ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_agents_session_id_and_sequence", (q) => q.eq("agentsSessionId", session._id))
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_THREAD),
    ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_kind", (q) =>
        q.eq("sessionId", session._id).eq("kind", "web_search_call"),
      )
      .take(1_000),
  ]);
  return estimateAgentsApiCost({
    model: session.model,
    reportedModelUsd: session.reportedModelUsd ?? null,
    modelUsageIncomplete: session.modelUsageIncomplete ?? false,
    usage: session.usage,
    webSearchCalls: searches.length < 1_000 ? searches.length : null,
    browsers: browsers.map(({ lifecycle }) => ({
      startedAt: lifecycle.openedAtMs,
      endedAt:
        lifecycle.kind === "closed"
          ? lifecycle.openedAtMs +
            (lifecycle.providerDurationMs ?? lifecycle.closedAtMs - lifecycle.openedAtMs)
          : null,
      creditsUsed: lifecycle.kind === "closed" ? lifecycle.creditsBilled : null,
    })),
    firecrawlUsdPerCredit: null,
    now: Date.now(),
  });
}

export const cost = query({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.object({
    cost: agentsApiCostValidator,
    usage: v.union(sessionUsage, v.null()),
    checks: v.array(checkSummary.pick("cost")),
    research: v.union(researchSummary.pick("reportedCredits"), v.null()),
  }),
  handler: async (ctx, args) => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    const [cost, checks, research] = await Promise.all([
      estimateSessionCost(ctx, session),
      listChecks(ctx, session._id),
      getResearch(ctx, session._id),
    ]);
    return {
      cost,
      usage: session.usage,
      checks: checks.map((check) => ({ cost: summarizeCheck(check).cost })),
      research: research ? { reportedCredits: summarizeResearch(research).reportedCredits } : null,
    };
  },
});

export const get = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionId);
    const canControl = session.userId === ctx.viewer.userId;
    const { _id, title, scoutId, scoutName, state, active, model, providerId, usage, browser } =
      session;
    const cleanup = session.cleanupJobId ? await ctx.db.system.get(session.cleanupJobId) : null;
    const cost = await estimateSessionCost(ctx, session);
    const checks = await listChecks(ctx, session._id);
    const research = await getResearch(ctx, session._id);
    return {
      _id,
      title,
      scoutId,
      scoutName,
      state,
      active,
      canControl,
      pendingMessage: session.pendingMessage ?? null,
      cleanupError: cleanup?.state.kind === "failed" ? cleanup.state.error : null,
      model,
      providerId,
      hasChat: Boolean(providerId),
      engine: session.engine,
      usage,
      cost,
      checks: checks.map(summarizeCheck),
      research: research ? summarizeResearch(research) : null,
      checkMessage: await currentCheckMessage(ctx, session),
      browser: browser
        ? {
            liveViewUrl: browser.liveViewUrl,
            interactiveLiveViewUrl: canControl ? browser.interactiveLiveViewUrl : null,
          }
        : null,
    };
  },
});

export const listItems = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    schema.doc("agentsApiItems").extend({ tool: v.union(toolActivityValidator, v.null()) }),
  ),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionId);
    const result = await ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 50),
        maximumRowsRead: Math.min(args.paginationOpts.maximumRowsRead ?? 100, 100),
        maximumBytesRead: Math.min(args.paginationOpts.maximumBytesRead ?? 1_000_000, 1_000_000),
      });
    const rows = await Promise.all(
      result.page.map(async (item) => {
        if (await pairedAgentsOutput(ctx, item)) return [];
        return [{ ...item, tool: await agentsToolActivity(ctx, session, item, "admin") }];
      }),
    );
    return { ...result, page: rows.flat() };
  },
});

export const listBrowsers = query({
  access: "access_lab",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.array(
    v.object({
      _id: v.id("agentsApiBrowserSessions"),
      sequence: v.number(),
      lifecycle: browserSessionLifecycleValidator,
      liveViewUrl: v.union(v.string(), v.null()),
      interactiveLiveViewUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionId);
    const browsers = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_agents_session_id_and_sequence", (q) =>
        q.eq("agentsSessionId", args.sessionId),
      )
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_THREAD);
    return browsers.map((browser) => {
      const handle =
        browser.lifecycle.kind === "active" &&
        session.browser?.providerSessionId === browser.providerSessionId
          ? session.browser
          : null;
      return {
        _id: browser._id,
        sequence: browser.sequence,
        lifecycle: browser.lifecycle,
        liveViewUrl: handle?.liveViewUrl ?? null,
        interactiveLiveViewUrl:
          session.userId === ctx.viewer.userId ? (handle?.interactiveLiveViewUrl ?? null) : null,
      };
    });
  },
});

export async function startSession(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    scoutId: Id<"scouts">;
    prompt: string;
    engine: Infer<typeof taskEngine>;
  },
): Promise<Id<"agentsApiSessions">> {
  const prompt = args.prompt.trim();
  if (!prompt || prompt.length > 20_000)
    throw new Error("Enter a prompt of at most 20,000 characters");
  const scout = await ctx.db.get(args.scoutId);
  if (!scout || scout.status !== "active") throw new Error("Active Scout not found");
  await requireAvailableScout(ctx, scout._id);
  const sessionId = await ctx.db.insert("agentsApiSessions", {
    engine: args.engine,
    userId: args.userId,
    scoutId: scout._id,
    scoutName: scout.displayName,
    title: "New session",
    model: "gpt-5.6-luna",
    state: { kind: "starting" },
    active: true,
    nextSequence: 0,
    browser: null,
    usage: null,
  });
  const checkId = await ctx.db.insert("agentsApiRequestChecks", {
    kind: "initial",
    sessionId,
    model: REQUEST_CHECK_MODEL,
    prompt,
    state: { kind: "pending" },
  });
  await startWorkflow(ctx, sessionId, { kind: "start", prompt, checkId });
  return sessionId;
}

export const start = mutation({
  access: "access_lab",
  args: { scoutId: v.id("scouts"), prompt: v.string(), engine: taskEngine },
  returns: v.id("agentsApiSessions"),
  handler: async (ctx, args): Promise<Id<"agentsApiSessions">> =>
    await startSession(ctx, { ...args, userId: ctx.viewer.userId }),
});

export const controls = query({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    const cleanup = session.cleanupJobId ? await ctx.db.system.get(session.cleanupJobId) : null;
    const notification = session.handoffEmailJobId
      ? await ctx.db.system.get(session.handoffEmailJobId)
      : null;
    const busy = !session.active && (await scoutReservation(ctx, session.scoutId)) !== null;
    return {
      state: session.state,
      active: session.active,
      pendingMessage: session.pendingMessage ?? null,
      canRetryMessage:
        !session.active &&
        Boolean(session.providerId) &&
        !busy &&
        session.pendingMessage?.status === "queued",
      requestCheckMessage: await currentCheckMessage(ctx, session),
      resumeAttempts: await resumeAttempts(ctx, session._id),
      canSend: !session.active && Boolean(session.providerId) && !busy,
      canStop:
        session.active && (session.state.kind !== "stopped" || cleanup?.state.kind === "failed"),
      busy,
      handoffEmailFailed: notification?.state.kind === "failed",
      interactiveLiveViewUrl:
        session.state.kind === "waiting" ? (session.browser?.interactiveLiveViewUrl ?? null) : null,
    };
  },
});

export const send = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    if (session.active || !session.providerId)
      throw new Error("Stop the current run before sending another message");
    const message = args.message.trim();
    if (!message || message.length > 20_000)
      throw new Error("Enter a message of at most 20,000 characters");
    await requireAvailableScout(ctx, session.scoutId);
    await ctx.db.patch(session._id, {
      active: true,
      state: { kind: "running" },
      cleanupJobId: undefined,
      handoffAccess: undefined,
    });
    await startWorkflow(ctx, session._id, { kind: "send", message });
    return null;
  },
});

export const retryMessage = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    if (session.active || !session.providerId || session.pendingMessage?.status !== "queued")
      throw new Error("Only a message that has not been submitted can be retried");
    await requireAvailableScout(ctx, session.scoutId);
    await ctx.db.patch(session._id, {
      active: true,
      state: { kind: "running" },
      cleanupJobId: undefined,
      handoffAccess: undefined,
    });
    await startWorkflow(ctx, session._id, {
      kind: "send",
      message: session.pendingMessage.message,
    });
    return null;
  },
});

export const messageDelivery = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    workflowId: vWorkflowId,
    status: v.union(v.literal("submitting"), v.literal("accepted"), v.literal("rejected")),
  },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, workflowId, status }): Promise<boolean> => {
    const session = await requireSession(ctx, sessionId);
    const pending = session.pendingMessage;
    if (session.workflowId !== workflowId || pending?.workflowId !== workflowId) return false;
    switch (status) {
      case "submitting":
        if (!session.active || session.state.kind === "stopped" || pending.status !== "queued")
          return false;
        await ctx.db.patch(sessionId, { pendingMessage: { ...pending, status } });
        return true;
      case "rejected":
        if (pending.status !== "submitting") return false;
        await ctx.db.patch(sessionId, { pendingMessage: { ...pending, status: "queued" } });
        return true;
      case "accepted":
        await ctx.db.patch(sessionId, { pendingMessage: undefined });
        return true;
    }
  },
});

export async function resumeHandoff(
  ctx: MutationCtx,
  session: Doc<"agentsApiSessions">,
  args: { sessionId: Id<"agentsApiSessions">; callId: string; turnId: string },
): Promise<null> {
  await requireSessionPermission(ctx, session);
  if (
    session.state.kind !== "waiting" ||
    session.state.callId !== args.callId ||
    session.state.turnId !== args.turnId
  )
    throw new ConvexError("Session is no longer waiting for this handoff");
  if (session.state.expiresAt !== undefined && session.state.expiresAt <= Date.now()) {
    await ctx.runMutation(internal.tasks.sessions.expireHandoff, {
      ...args,
      expiresAt: session.state.expiresAt,
    });
    return null;
  }
  if (!session.browser) throw new ConvexError("Handoff browser is not available");
  const initial = await getInitialCheck(ctx, session._id);
  if (!initial) throw new ConvexError("Original request check not found");
  if ((await listChecks(ctx, session._id)).length >= MAX_SESSION_CHECKS)
    throw new ConvexError("This session reached its check limit. Stop it and start a new session.");
  const checkId = await ctx.db.insert("agentsApiRequestChecks", {
    kind: "resume",
    sessionId: session._id,
    model: REQUEST_CHECK_MODEL,
    prompt: initial.prompt,
    handoff: {
      callId: session.state.callId,
      turnId: session.state.turnId,
      message: session.state.message,
      ...omitNullish({ expiresAt: session.state.expiresAt }),
    },
    providerSessionId: session.browser.providerSessionId,
    evidence: null,
    state: { kind: "pending" },
  });
  await ctx.db.patch(session._id, { state: { kind: "checking", checkId } });
  await startWorkflow(ctx, session._id, { kind: "resume", checkId });
  console.info("Task resume requested", {
    sessionId: session._id,
    checkId,
    callId: args.callId,
    userId: session.userId,
  });
  return null;
}

export const resume = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string(), turnId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    return await resumeHandoff(ctx, session, args);
  },
});

export const stop = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    await stopSession(
      ctx,
      session,
      session.state.kind === "stopped" ? session.state : { kind: "stopped" },
    );
    console.info("Task stop requested", {
      sessionId: session._id,
      previousState: session.state.kind,
      userId: ctx.viewer.userId,
    });
    return null;
  },
});

export const scheduleCleanup = internalMutation({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    await scheduleSessionCleanup(ctx, session);
    return null;
  },
});

export const enterHandoff = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    message: v.string(),
    callId: v.string(),
    turnId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, ...handoff }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.state.kind === "stopped") return false;
    if (session.state.kind !== "running") throw new Error("Session is no longer running");
    if (!session.browser?.interactiveLiveViewUrl)
      throw new Error("No interactive browser is available for handoff");
    const expiresAt = await browserHandoffDeadline(ctx, session);
    await ctx.db.patch(sessionId, {
      state: { kind: "waiting", ...handoff, expiresAt },
      handoffAccess: undefined,
    });
    await ctx.scheduler.runAt(expiresAt, internal.tasks.sessions.expireHandoff, {
      sessionId,
      callId: handoff.callId,
      turnId: handoff.turnId,
      expiresAt,
    });
    console.info("Task waiting for browser handoff", {
      sessionId,
      callId: handoff.callId,
      turnId: handoff.turnId,
      expiresAt,
    });
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", sessionId))
      .unique();
    if (chat?.purpose.kind === "review") {
      const handoffEmailJobId = await ctx.scheduler.runAfter(0, internal.tasks.handoff.notify, {
        sessionId,
        callId: handoff.callId,
      });
      await ctx.db.patch(sessionId, { handoffEmailJobId });
    }
    return true;
  },
});

export const handoffNotification = internalQuery({
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.state.kind !== "waiting" || session.state.callId !== args.callId)
      return null;
    const chat = await requireSessionPermission(ctx, session);
    if (chat?.purpose.kind !== "review") return null;
    const [owner, scout] = await Promise.all([
      ctx.db.get(session.userId),
      ctx.db.get(session.scoutId),
    ]);
    if (!owner || owner.state === "deleted" || !owner.email || !scout)
      throw new Error("Handoff email recipient or Scout is missing");
    return {
      recipient: owner.email,
      inboxId: scout.agentMail.inboxId,
      scoutName: scout.displayName,
      expiresAt: session.state.expiresAt ?? null,
      turnId: session.state.turnId,
      providerSessionId: session.browser?.providerSessionId ?? null,
    };
  },
});

export const runtime = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.sessionId);
    const chat = await requireSessionPermission(ctx, session);
    const scout = await ctx.db.get(session.scoutId);
    if (!scout || scout.status !== "active") throw new Error("Active Scout not found");
    return { session, scout, purpose: chat?.purpose ?? { kind: "general" as const } };
  },
});

export const update = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    refreshWorkflowId: v.optional(v.union(vWorkflowId, v.null())),
    providerId: v.optional(v.string()),
    previousTurnId: v.optional(v.string()),
    modelTurnId: v.optional(v.string()),
    state: v.optional(sessionState),
    active: v.optional(v.boolean()),
    usage: v.optional(v.union(sessionUsage, v.null())),
    reportedModelUsd: v.optional(v.union(v.number(), v.null())),
    modelUsageIncomplete: v.optional(v.boolean()),
    browser: v.optional(v.union(browserHandle, v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, refreshWorkflowId, ...patch }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (
      refreshWorkflowId !== undefined &&
      ((session.active && session.state.kind !== "waiting") ||
        (session.workflowId ?? null) !== refreshWorkflowId)
    )
      return null;
    if (session.state.kind === "stopped") delete patch.state;
    if (
      session.active &&
      patch.active === false &&
      (session.engine ?? "agents_api") === "agents_api" &&
      session.providerId
    ) {
      patch.modelUsageIncomplete = true;
      await ctx.scheduler.runAfter(0, internal.tasks.agentsApi.refreshUsage, {
        sessionId,
        workflowId: session.workflowId ?? null,
        attempt: 0,
        ...omitNullish({
          billing: session.billingEnabled
            ? {
                userId: session.userId,
                providerId: session.providerId,
                model: session.model,
                turnId: patch.modelTurnId ?? session.modelTurnId ?? null,
              }
            : undefined,
        }),
      });
    }
    await ctx.db.patch(sessionId, patch);
    return null;
  },
});

export const saveItems = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    refreshWorkflowId: v.optional(v.union(vWorkflowId, v.null())),
    items: v.array(sessionItem),
    cursor: v.optional(v.string()),
    sequence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (
      args.refreshWorkflowId !== undefined &&
      ((session.active && session.state.kind !== "waiting") ||
        (session.workflowId ?? null) !== args.refreshWorkflowId)
    )
      return null;
    let sequence = args.sequence ?? session.nextSequence;
    for (const item of args.items) {
      const existing = await ctx.db
        .query("agentsApiItems")
        .withIndex("by_session_id_and_provider_item_id", (q) =>
          q.eq("sessionId", session._id).eq("providerItemId", item.providerItemId),
        )
        .unique();
      const position =
        args.sequence === undefined ? (existing?.sequence ?? sequence++) : sequence++;
      if (existing) {
        if (existing.complete && item.complete === false) {
          if (existing.sequence !== position)
            await ctx.db.patch(existing._id, { sequence: position });
          continue;
        }
        if (
          existing.text !== item.text ||
          existing.details !== item.details ||
          existing.complete !== item.complete ||
          existing.sequence !== position
        )
          await ctx.db.patch(existing._id, { ...item, sequence: position });
      } else {
        await ctx.db.insert("agentsApiItems", {
          ...item,
          sessionId: session._id,
          sequence: position,
        });
      }
    }
    await ctx.db.patch(session._id, {
      nextSequence: Math.max(session.nextSequence, sequence),
      ...omitNullish({ itemCursor: args.cursor }),
    });
    return null;
  },
});

export const itemSequence = internalQuery({
  args: { sessionId: v.id("agentsApiSessions"), providerItemId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_provider_item_id", (q) =>
        q.eq("sessionId", args.sessionId).eq("providerItemId", args.providerItemId),
      )
      .unique();
    if (!item) throw new Error("Saved history cursor is missing its item");
    return item.sequence;
  },
});

export const claimCall = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentsApiCalls")
      .withIndex("by_session_id_and_call_id", (q) =>
        q.eq("sessionId", args.sessionId).eq("callId", args.callId),
      )
      .unique();
    if (existing) return { fresh: false, call: existing };
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.state.kind !== "running")
      throw new Error("Session stopped before tool dispatch");
    const id = await ctx.db.insert("agentsApiCalls", { ...args, result: { kind: "running" } });
    return { fresh: true, call: (await ctx.db.get(id))! };
  },
});

export const finishCall = internalMutation({
  args: { callId: v.id("agentsApiCalls"), result: callResult },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callId, { result: args.result });
    return null;
  },
});

export const cleanupResources = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    return requireSession(ctx, args.sessionId);
  },
});
