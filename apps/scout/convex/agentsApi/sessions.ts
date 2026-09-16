import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
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
} from "./model";
import type { Infer } from "convex/values";
import { MAX_BROWSER_SESSIONS_PER_THREAD } from "../scout/browserSessions";
import { browserSessionLifecycleValidator } from "../browserModel";
import { estimateAgentsApiCost } from "./cost";
import { getInitialCheck, listChecks, summarizeCheck, currentCheckMessage } from "./requestChecks";
import { REQUEST_CHECK_MODEL, MAX_SESSION_CHECKS, checkSummary } from "./requestCheckModel";
import { getResearch, summarizeResearch } from "./siteResearchRecords";
import { researchSummary } from "./siteResearchModel";
import { notification } from "../../shared/openaiAgents";

async function requireSession(ctx: QueryCtx, sessionId: Id<"agentsApiSessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found");
  return session;
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
  if (session.pendingCommand && session.providerId) return;
  if (session.cleanupComplete) {
    await releaseScout(ctx, session);
    return;
  }
  if (
    session.state.kind !== "stopped" &&
    session.state.kind !== "failed" &&
    session.state.kind !== "idle" &&
    session.state.kind !== "waiting"
  ) {
    throw new Error("Stop the session before scheduling cleanup");
  }
  const job = session.cleanupJobId ? await ctx.db.system.get(session.cleanupJobId) : null;
  if (job?.state.kind === "pending" || job?.state.kind === "inProgress") return;
  const cleanupJobId = await ctx.scheduler.runAfter(0, internal.agentsApi.runtime.cleanup, {
    sessionId: session._id,
  });
  await ctx.db.patch(session._id, { cleanupJobId });
}

async function releaseScout(ctx: MutationCtx, session: Doc<"agentsApiSessions">) {
  if (!session.cleanupComplete || (session.pendingCommand && session.providerId)) return;
  const runningCall = await ctx.db
    .query("agentsApiCalls")
    .withIndex("by_session_id_and_result_kind", (q) =>
      q.eq("sessionId", session._id).eq("result.kind", "running"),
    )
    .first();
  if (!runningCall) await ctx.db.patch(session._id, { active: false });
}

async function startWorkflow(
  ctx: MutationCtx,
  sessionId: Id<"agentsApiSessions">,
  input: Infer<typeof command>,
) {
  const workflowId = await workflow.start(
    ctx,
    internal.agentsApi.lifecycle.run,
    {
      sessionId,
      command: input,
    },
    {
      startAsync: true,
      onComplete: internal.agentsApi.lifecycle.onComplete,
      context: { sessionId },
    },
  );
  await ctx.db.patch(sessionId, { workflowId, pendingCommand: true, cleanupComplete: undefined });
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
        sessions.page.map(async ({ _id, _creationTime, title, scoutName, state, providerId }) => {
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
            research: research ? summarizeResearch(research) : null,
          };
        }),
      ),
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
    const cost = estimateAgentsApiCost({
      model,
      usage,
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
      cleanupError: cleanup?.state.kind === "failed" ? cleanup.state.error : null,
      model,
      providerId,
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
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionId);
    return await ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .paginate(args.paginationOpts);
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
  args: { userId: Id<"users">; scoutId: Id<"scouts">; prompt: string },
): Promise<Id<"agentsApiSessions">> {
  const prompt = args.prompt.trim();
  if (!prompt || prompt.length > 20_000)
    throw new Error("Enter a prompt of at most 20,000 characters");
  const scout = await ctx.db.get(args.scoutId);
  if (!scout || scout.status !== "active") throw new Error("Active Scout not found");
  await requireAvailableScout(ctx, scout._id);
  const sessionId = await ctx.db.insert("agentsApiSessions", {
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
  args: { scoutId: v.id("scouts"), prompt: v.string() },
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
      requestCheckMessage: await currentCheckMessage(ctx, session),
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
    });
    await startWorkflow(ctx, session._id, { kind: "send", message });
    return null;
  },
});

export const resume = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string(), turnId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    if (
      session.state.kind !== "waiting" ||
      session.state.callId !== args.callId ||
      session.state.turnId !== args.turnId
    )
      throw new Error("Session is no longer waiting for this handoff");
    if (!session.browser) throw new Error("Handoff browser is not available");
    const initial = await getInitialCheck(ctx, session._id);
    if (!initial) throw new Error("Original request check not found");
    if ((await listChecks(ctx, session._id)).length >= MAX_SESSION_CHECKS)
      throw new Error("This session reached its check limit. Stop it and start a new session.");
    const checkId = await ctx.db.insert("agentsApiRequestChecks", {
      kind: "resume",
      sessionId: session._id,
      model: REQUEST_CHECK_MODEL,
      prompt: initial.prompt,
      handoff: {
        callId: session.state.callId,
        turnId: session.state.turnId,
        message: session.state.message,
      },
      providerSessionId: session.browser.providerSessionId,
      evidence: null,
      state: { kind: "pending" },
    });
    await ctx.db.patch(session._id, { state: { kind: "checking", checkId } });
    await startWorkflow(ctx, session._id, { kind: "resume", checkId });
    return null;
  },
});

export const stop = mutation({
  access: "access_account",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await owned(ctx, args.sessionId, ctx.viewer.userId);
    await requireSessionPermission(ctx, session);
    await ctx.db.patch(session._id, { state: { kind: "stopped" } });
    await scheduleSessionCleanup(ctx, { ...session, state: { kind: "stopped" } });
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
    await ctx.db.patch(sessionId, { state: { kind: "waiting", ...handoff } });
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", sessionId))
      .unique();
    if (chat?.purpose.kind === "review") {
      const handoffEmailJobId = await ctx.scheduler.runAfter(0, internal.agentsApi.handoff.notify, {
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
    };
  },
});

export const runtime = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    const chat = await requireSessionPermission(ctx, session);
    const scout = await ctx.db.get(session.scoutId);
    if (!scout || scout.status !== "active") throw new Error("Active Scout not found");
    return { session, scout, purpose: chat?.purpose ?? { kind: "general" as const } };
  },
});

export const update = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    providerId: v.optional(v.string()),
    state: v.optional(sessionState),
    active: v.optional(v.boolean()),
    usage: v.optional(v.union(sessionUsage, v.null())),
    browser: v.optional(v.union(browserHandle, v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, ...patch }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.state.kind === "stopped") delete patch.state;
    await ctx.db.patch(sessionId, patch);
    return null;
  },
});

export const saveItems = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    items: v.array(sessionItem),
    sequence: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
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
    });
    return null;
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
    const call = await ctx.db.get(args.callId);
    if (!call) throw new Error("Tool call not found");
    await ctx.db.patch(args.callId, { result: args.result });
    await releaseScout(ctx, await requireSession(ctx, call.sessionId));
    return null;
  },
});

export const completeCleanup = internalMutation({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await requireSession(ctx, sessionId);
    await ctx.db.patch(sessionId, { cleanupComplete: true });
    await releaseScout(ctx, { ...session, cleanupComplete: true });
    return null;
  },
});

export const cleanupResources = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    return session;
  },
});

export const onEvent = internalMutation({
  args: notification.fields,
  returns: v.null(),
  handler: async (ctx, { sessionKey, runKey, event }) => {
    const sessionId = ctx.db.normalizeId("agentsApiSessions", sessionKey);
    const session = sessionId ? await ctx.db.get(sessionId) : null;
    if (!session || session.workflowId !== runKey) return null;
    switch (event.kind) {
      case "created":
        await ctx.db.patch(session._id, {
          providerId: event.providerId,
          ...(session.state.kind === "starting" ? { state: { kind: "running" as const } } : {}),
        });
        break;
      case "item":
        await ctx.runMutation(internal.agentsApi.sessions.saveItems, {
          sessionId: session._id,
          items: [event.item],
          sequence: event.sequence,
        });
        break;
      case "tool":
        if (session.active && session.state.kind === "running") {
          await ctx.scheduler.runAfter(0, internal.agentsApi.runtime.executeTool, {
            sessionId: session._id,
            runKey,
            call: event.call,
          });
        }
        break;
      case "state":
        if (event.usage !== null) await ctx.db.patch(session._id, { usage: event.usage });
        if (!session.active || session.state.kind === "stopped" || session.state.kind === "failed")
          break;
        if (event.state.kind === "running") break;
        await ctx.db.patch(session._id, { state: event.state });
        await scheduleSessionCleanup(ctx, { ...session, state: event.state });
        break;
      default: {
        const unhandled: never = event;
        throw new Error(`Unknown session event: ${JSON.stringify(unhandled)}`);
      }
    }
    return null;
  },
});

export const fail = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), runKey: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, runKey, error }) => {
    const session = await requireSession(ctx, sessionId);
    if (session.workflowId !== runKey) return null;
    const state =
      session.state.kind === "stopped" ? session.state : { kind: "failed" as const, error };
    await ctx.db.patch(sessionId, { state });
    await scheduleSessionCleanup(ctx, { ...session, state });
    return null;
  },
});
