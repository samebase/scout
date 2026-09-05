import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireAppUser } from "../access";
import schema from "../schema";
import { failHumanHandoffForSession } from "../humanHandoffsModel";
import {
  browserActionValidator,
  browserClickCaptureValidator,
  MAX_BROWSER_CLICKS_PER_OPERATION,
  browserOperationStateValidator,
  browserOutcomeValidator,
  browserSessionLifecycleValidator,
  browserViewportValidator,
} from "../browserModel";
import { requireFirecrawlLiveViewUrl } from "./lib/firecrawlLiveView";
import { requireFirecrawlCdpUrl } from "./lib/firecrawlCdpUrl";
import { omitNullish } from "../../shared/omitNullish";
import { activeBrowserForChat } from "./chatAccess";

const MAX_BROWSER_SESSION_ID_LENGTH = 500;
const MAX_BROWSER_TOOL_CALL_ID_LENGTH = 200;
const MAX_BROWSER_FAILURE_LENGTH = 2_000;
const MAX_BROWSER_OPERATIONS = 500;
const MAX_BROWSER_SESSIONS_PER_THREAD = 50;
const BROWSER_VIEWPORT = { width: 1_280, height: 800 } as const;

const browserOperationValidator = v.object({
  operationId: v.id("scoutBrowserOperations"),
  sequence: v.number(),
  toolCallId: v.string(),
  action: browserActionValidator,
  state: browserOperationStateValidator,
});

const browserSessionSummaryValidator = v.object({
  sessionId: v.id("scoutBrowserSessions"),
  sequence: v.number(),
  createdAt: v.number(),
  provider: v.literal("firecrawl"),
  profileName: v.string(),
  viewport: browserViewportValidator,
  lifecycle: browserSessionLifecycleValidator,
  operationCount: v.number(),
});

const browserSessionDetailValidator = browserSessionSummaryValidator.extend({
  operations: v.array(browserOperationValidator),
});

export const replayOperationValidator = v.object({
  sequence: v.number(),
  state: browserOperationStateValidator,
  clickCapture: v.union(browserClickCaptureValidator, v.null()),
});

export type ReplayOperation = Infer<typeof replayOperationValidator>;

function boundedFailure(value: string) {
  const characters = Array.from(value.trim().replaceAll(/\s+/g, " "));
  return characters.length <= MAX_BROWSER_FAILURE_LENGTH
    ? characters.join("")
    : `${characters.slice(0, MAX_BROWSER_FAILURE_LENGTH - 1).join("")}…`;
}

function addProviderUsage(current: number | undefined, next: number | null) {
  return next === null ? current : (current ?? 0) + next;
}

async function requireThreadBinding(ctx: Pick<QueryCtx | MutationCtx, "db">, threadId: string) {
  const binding = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (index) => index.eq("threadId", threadId))
    .unique();
  if (!binding) throw new Error("thread not found");
  return binding;
}

async function ownedSession(
  ctx: QueryCtx,
  args: { sessionId: Id<"scoutBrowserSessions">; userId: Id<"users"> },
) {
  const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
  if (!session) return null;
  const binding = await requireThreadBinding(ctx, session.threadId);
  if (binding.userId !== args.userId || binding.scoutId !== session.scoutId) return null;
  return session;
}

function projectSession(session: Doc<"scoutBrowserSessions">) {
  const lifecycle =
    session.lifecycle.kind === "active"
      ? { kind: "active" as const, openedAtMs: session.lifecycle.openedAtMs }
      : session.lifecycle.kind === "closing"
        ? {
            kind: "closing" as const,
            openedAtMs: session.lifecycle.openedAtMs,
            closingAtMs: session.lifecycle.closingAtMs,
          }
        : session.lifecycle;
  return {
    sessionId: session._id,
    sequence: session.sequence,
    createdAt: session._creationTime,
    provider: session.provider,
    profileName: session.profileName,
    viewport: session.viewport,
    lifecycle,
    operationCount: Math.max(0, session.nextOperationSequence - 1),
  };
}

async function sessionOperations(ctx: Pick<QueryCtx, "db">, sessionId: Id<"scoutBrowserSessions">) {
  return await ctx.db
    .query("scoutBrowserOperations")
    .withIndex("by_session_id_and_sequence", (index) => index.eq("sessionId", sessionId))
    .order("asc")
    .take(MAX_BROWSER_OPERATIONS);
}

export const list = query({
  args: { threadId: v.string() },
  returns: v.array(browserSessionSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const binding = await requireThreadBinding(ctx, args.threadId);
    if (binding.userId !== userId) return [];
    const sessions = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (index) => index.eq("threadId", args.threadId))
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_THREAD);
    return sessions.map(projectSession);
  },
});

export const get = query({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(browserSessionDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const session = await ownedSession(ctx, { sessionId: args.sessionId, userId });
    if (!session) return null;
    const operations = await sessionOperations(ctx, session._id);
    return {
      ...projectSession(session),
      operations: operations.map((operation) => ({
        operationId: operation._id,
        sequence: operation.sequence,
        toolCallId: operation.toolCallId,
        action: operation.action,
        state: operation.state,
      })),
    };
  },
});

export const liveView = query({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(v.object({ url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const session = await ownedSession(ctx, { sessionId: args.sessionId, userId });
    if (!session || session.lifecycle.kind !== "active") return null;
    const liveView = await ctx.db
      .query("scoutLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    return liveView ? { url: requireFirecrawlLiveViewUrl(liveView.liveViewUrl) } : null;
  },
});

export const replayData = internalQuery({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(
    v.object({
      providerSessionId: v.string(),
      viewport: browserViewportValidator,
      lifecycle: browserSessionLifecycleValidator,
      operations: v.array(replayOperationValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const session = await ownedSession(ctx, { sessionId: args.sessionId, userId });
    if (!session) return null;
    const operations = await sessionOperations(ctx, session._id);
    return {
      providerSessionId: session.providerSessionId,
      viewport: session.viewport,
      lifecycle: projectSession(session).lifecycle,
      operations: operations.map((operation) => ({
        sequence: operation.sequence,
        state: operation.state,
        clickCapture: operation.clickCapture ?? null,
      })),
    };
  },
});

export const open = internalMutation({
  args: {
    threadId: v.string(),
    scoutId: v.id("scouts"),
    source: v.union(
      v.object({ kind: v.literal("manual") }),
      v.object({ kind: v.literal("turn"), turnId: v.id("scoutTurns") }),
    ),
    providerSessionId: v.string(),
    cdpUrl: v.string(),
    interactiveLiveViewUrl: v.union(v.string(), v.null()),
    providerExpiresAtMs: v.number(),
    profileName: v.string(),
  },
  returns: v.object({
    sessionId: v.id("scoutBrowserSessions"),
    captureOperations: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const providerSessionId = args.providerSessionId.trim();
    if (!providerSessionId || providerSessionId.length > MAX_BROWSER_SESSION_ID_LENGTH) {
      throw new Error("Firecrawl browser session ID is invalid");
    }
    const cdpUrl = requireFirecrawlCdpUrl(args.cdpUrl);
    const interactiveLiveViewUrl =
      args.interactiveLiveViewUrl === null
        ? null
        : requireFirecrawlLiveViewUrl(args.interactiveLiveViewUrl);
    const binding = await requireThreadBinding(ctx, args.threadId);
    if (binding.scoutId !== args.scoutId) throw new Error("browser Scout does not match");
    if (args.source.kind === "turn") {
      const turn = await ctx.db.get("scoutTurns", args.source.turnId);
      if (
        !turn ||
        turn.threadId !== args.threadId ||
        turn.scoutId !== args.scoutId ||
        turn.state.kind !== "pending"
      ) {
        throw new Error("Active Scout turn not found");
      }
    }
    const existing = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_provider_and_provider_session_id", (index) =>
        index.eq("provider", "firecrawl").eq("providerSessionId", providerSessionId),
      )
      .unique();
    if (existing) {
      if (
        existing.threadId !== args.threadId ||
        existing.scoutId !== args.scoutId ||
        existing.lifecycle.kind !== "active"
      ) {
        throw new Error("Firecrawl session is not active for this thread");
      }
      return { sessionId: existing._id, captureOperations: true as const };
    }
    const latest = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (index) => index.eq("threadId", args.threadId))
      .order("desc")
      .first();
    if (await activeBrowserForChat(ctx, args.scoutId, args.threadId)) {
      throw new Error("This thread already has an active browser session");
    }
    const sequence = (latest?.sequence ?? 0) + 1;
    if (sequence > MAX_BROWSER_SESSIONS_PER_THREAD) {
      throw new Error(`A thread can have at most ${MAX_BROWSER_SESSIONS_PER_THREAD} sessions`);
    }
    return {
      sessionId: await ctx.db.insert("scoutBrowserSessions", {
        threadId: args.threadId,
        scoutId: args.scoutId,
        sequence,
        provider: "firecrawl",
        providerSessionId,
        profileName: args.profileName,
        viewport: BROWSER_VIEWPORT,
        nextOperationSequence: 1,
        lifecycle: {
          kind: "active",
          openedAtMs: Date.now(),
          providerExpiresAtMs: args.providerExpiresAtMs,
          cdpUrl,
          interactiveLiveViewUrl,
        },
      }),
      captureOperations: true as const,
    };
  },
});

export const replaceConnection = internalMutation({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    cdpUrl: v.string(),
    interactiveLiveViewUrl: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind !== "active") {
      throw new Error("Active browser session not found");
    }
    await ctx.db.patch("scoutBrowserSessions", session._id, {
      lifecycle: {
        ...session.lifecycle,
        cdpUrl: requireFirecrawlCdpUrl(args.cdpUrl),
        interactiveLiveViewUrl:
          args.interactiveLiveViewUrl === null
            ? null
            : requireFirecrawlLiveViewUrl(args.interactiveLiveViewUrl),
      },
    });
    return null;
  },
});

export const prepareOperation = internalMutation({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    toolCallId: v.string(),
    action: browserActionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const toolCallId = args.toolCallId.trim();
    if (!toolCallId || toolCallId.length > MAX_BROWSER_TOOL_CALL_ID_LENGTH) {
      throw new Error("Browser tool call ID is invalid");
    }
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind !== "active") {
      throw new Error("Active browser session not found");
    }
    await activeBrowserForChat(ctx, session.scoutId, session.threadId);
    const duplicate = await ctx.db
      .query("scoutBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", session._id).eq("toolCallId", toolCallId),
      )
      .unique();
    if (duplicate) return false;
    const sequence = session.nextOperationSequence;
    if (sequence > MAX_BROWSER_OPERATIONS) {
      throw new Error(`A browser session can have at most ${MAX_BROWSER_OPERATIONS} operations`);
    }
    await ctx.db.patch("scoutBrowserSessions", session._id, {
      nextOperationSequence: sequence + 1,
    });
    await ctx.db.insert("scoutBrowserOperations", {
      sessionId: session._id,
      sequence,
      toolCallId,
      action: args.action,
      state: { kind: "prepared", preparedAtMs: Date.now() },
    });
    return true;
  },
});

export const settleOperation = internalMutation({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    toolCallId: v.string(),
    outcome: browserOutcomeValidator,
    clickCapture: browserClickCaptureValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operation = await ctx.db
      .query("scoutBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", args.sessionId).eq("toolCallId", args.toolCallId.trim()),
      )
      .unique();
    if (!operation) throw new Error("browser operation not found");
    if (operation.state.kind !== "prepared") return null;
    const capture = args.clickCapture;
    if (capture.kind === "captured") {
      if (
        !Number.isFinite(capture.startedAtMs) ||
        !Number.isFinite(capture.endedAtMs) ||
        capture.endedAtMs < capture.startedAtMs ||
        capture.clicks.length > MAX_BROWSER_CLICKS_PER_OPERATION ||
        capture.clicks.some(
          (click) =>
            !click.tabId ||
            click.tabId.length > 200 ||
            !Number.isFinite(click.atMs) ||
            !Number.isFinite(click.x) ||
            !Number.isFinite(click.y) ||
            click.x < 0 ||
            click.x > 1 ||
            click.y < 0 ||
            click.y > 1,
        )
      )
        throw new Error("Invalid browser click capture");
    }
    const settledAtMs = Date.now();
    switch (args.outcome.kind) {
      case "applied":
      case "applied_snapshot_failed":
        await ctx.db.patch("scoutBrowserOperations", operation._id, {
          clickCapture: capture,
          state: { kind: args.outcome.kind, settledAtMs, telemetry: args.outcome.telemetry },
        });
        break;
      case "failed_before_dispatch":
      case "indeterminate_after_dispatch":
        await ctx.db.patch("scoutBrowserOperations", operation._id, {
          clickCapture: capture,
          state: {
            kind: args.outcome.kind,
            settledAtMs,
            failure: boundedFailure(args.outcome.failure),
          },
        });
        break;
    }
    return null;
  },
});

export const close = internalMutation({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
    usageTurnId: v.optional(v.id("scoutTurns")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind === "closed") return null;
    const handoff = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    const usageTurnId = args.usageTurnId ?? handoff?.turnId;
    const turn = usageTurnId ? await ctx.db.get("scoutTurns", usageTurnId) : null;
    if (
      args.usageTurnId &&
      (!turn || turn.threadId !== session.threadId || turn.scoutId !== session.scoutId)
    ) {
      throw new Error("Browser usage turn does not match the session");
    }
    await failHumanHandoffForSession(ctx, session._id);
    await ctx.db.patch("scoutBrowserSessions", session._id, {
      lifecycle: {
        kind: "closed",
        openedAtMs: session.lifecycle.openedAtMs,
        closedAtMs: Date.now(),
        providerDurationMs: args.providerDurationMs,
        creditsBilled: args.creditsBilled,
      },
    });
    if (turn) {
      await ctx.db.patch("scoutTurns", turn._id, {
        state: {
          ...turn.state,
          ...omitNullish({
            firecrawlCredits: addProviderUsage(turn.state.firecrawlCredits, args.creditsBilled),
            firecrawlDurationMs: addProviderUsage(
              turn.state.firecrawlDurationMs,
              args.providerDurationMs,
            ),
          }),
        },
      });
      await ctx.scheduler.runAfter(0, internal.scout.turns.finalizeStopping, {
        turnId: turn._id,
      });
    }
    const liveView = await ctx.db
      .query("scoutLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (liveView) await ctx.db.delete(liveView._id);
    return null;
  },
});

export const setLiveView = internalMutation({
  args: { sessionId: v.id("scoutBrowserSessions"), liveViewUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind !== "active") return null;
    const liveViewUrl = requireFirecrawlLiveViewUrl(args.liveViewUrl);
    const existing = await ctx.db
      .query("scoutLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (existing) {
      await ctx.db.replace("scoutLiveViews", existing._id, {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("scoutLiveViews", {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    }
    return null;
  },
});

export const clearLiveView = internalMutation({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const liveView = await ctx.db
      .query("scoutLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId))
      .unique();
    if (liveView) await ctx.db.delete(liveView._id);
    return null;
  },
});

export const getForHandoff = internalQuery({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(schema.doc("scoutBrowserSessions"), v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.sessionId),
});
