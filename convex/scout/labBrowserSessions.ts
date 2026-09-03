import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireAppUser } from "../access";
import {
  taskBrowserActionValidator,
  taskBrowserOperationStateValidator,
  taskBrowserOutcomeValidator,
  taskBrowserSessionLifecycleValidator,
  taskBrowserViewportValidator,
} from "../taskBrowserModel";
import { requireFirecrawlLiveViewUrl } from "./lib/firecrawlLiveView";

const MAX_BROWSER_SESSION_ID_LENGTH = 500;
const MAX_BROWSER_TOOL_CALL_ID_LENGTH = 200;
const MAX_BROWSER_FAILURE_LENGTH = 2_000;
const MAX_BROWSER_OPERATIONS = 100;
const MAX_BROWSER_SESSIONS_PER_THREAD = 50;
const LAB_BROWSER_VIEWPORT = { width: 1_280, height: 800 } as const;

const labBrowserOperationValidator = v.object({
  operationId: v.id("scoutLabBrowserOperations"),
  sequence: v.number(),
  toolCallId: v.string(),
  action: taskBrowserActionValidator,
  state: taskBrowserOperationStateValidator,
});

const labBrowserSessionSummaryValidator = v.object({
  sessionId: v.id("scoutLabBrowserSessions"),
  sequence: v.number(),
  createdAt: v.number(),
  provider: v.literal("firecrawl"),
  profileName: v.string(),
  viewport: taskBrowserViewportValidator,
  lifecycle: taskBrowserSessionLifecycleValidator,
  operationCount: v.number(),
});

const labBrowserSessionDetailValidator = labBrowserSessionSummaryValidator.extend({
  operations: v.array(labBrowserOperationValidator),
});

export const replayOperationValidator = v.object({
  sequence: v.number(),
  state: taskBrowserOperationStateValidator,
});

export type LabReplayOperation = Infer<typeof replayOperationValidator>;

function boundedFailure(value: string) {
  const characters = Array.from(value.trim().replaceAll(/\s+/g, " "));
  return characters.length <= MAX_BROWSER_FAILURE_LENGTH
    ? characters.join("")
    : `${characters.slice(0, MAX_BROWSER_FAILURE_LENGTH - 1).join("")}…`;
}

async function requireThreadBinding(ctx: Pick<QueryCtx | MutationCtx, "db">, threadId: string) {
  const binding = await ctx.db
    .query("scoutLabThreads")
    .withIndex("by_thread_id", (index) => index.eq("threadId", threadId))
    .unique();
  if (!binding) throw new Error("Lab thread not found");
  return binding;
}

async function ownedSession(
  ctx: QueryCtx,
  args: { sessionId: Id<"scoutLabBrowserSessions">; userId: Id<"users"> },
) {
  const session = await ctx.db.get("scoutLabBrowserSessions", args.sessionId);
  if (!session) return null;
  const binding = await requireThreadBinding(ctx, session.threadId);
  if (binding.userId !== args.userId || binding.scoutId !== session.scoutId) return null;
  return session;
}

function projectSession(session: Doc<"scoutLabBrowserSessions">) {
  return {
    sessionId: session._id,
    sequence: session.sequence,
    createdAt: session._creationTime,
    provider: session.provider,
    profileName: session.profileName,
    viewport: session.viewport,
    lifecycle: session.lifecycle,
    operationCount: Math.max(0, session.nextOperationSequence - 1),
  };
}

async function sessionOperations(
  ctx: Pick<QueryCtx, "db">,
  sessionId: Id<"scoutLabBrowserSessions">,
) {
  return await ctx.db
    .query("scoutLabBrowserOperations")
    .withIndex("by_session_id_and_sequence", (index) => index.eq("sessionId", sessionId))
    .order("asc")
    .take(MAX_BROWSER_OPERATIONS);
}

export const list = query({
  args: { threadId: v.string() },
  returns: v.array(labBrowserSessionSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const binding = await requireThreadBinding(ctx, args.threadId);
    if (binding.userId !== userId) return [];
    const sessions = await ctx.db
      .query("scoutLabBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (index) => index.eq("threadId", args.threadId))
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_THREAD);
    return sessions.map(projectSession);
  },
});

export const get = query({
  args: { sessionId: v.id("scoutLabBrowserSessions") },
  returns: v.union(labBrowserSessionDetailValidator, v.null()),
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
  args: { sessionId: v.id("scoutLabBrowserSessions") },
  returns: v.union(v.object({ url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const session = await ownedSession(ctx, { sessionId: args.sessionId, userId });
    if (!session || session.lifecycle.kind !== "active") return null;
    const liveView = await ctx.db
      .query("scoutLabLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    return liveView ? { url: requireFirecrawlLiveViewUrl(liveView.liveViewUrl) } : null;
  },
});

export const replayData = internalQuery({
  args: { sessionId: v.id("scoutLabBrowserSessions") },
  returns: v.union(
    v.object({
      providerSessionId: v.string(),
      viewport: taskBrowserViewportValidator,
      lifecycle: taskBrowserSessionLifecycleValidator,
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
      lifecycle: session.lifecycle,
      operations: operations.map((operation) => ({
        sequence: operation.sequence,
        state: operation.state,
      })),
    };
  },
});

export const open = internalMutation({
  args: {
    threadId: v.string(),
    scoutId: v.id("scouts"),
    providerSessionId: v.string(),
    profileName: v.string(),
  },
  returns: v.object({
    sessionId: v.id("scoutLabBrowserSessions"),
    captureOperations: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const providerSessionId = args.providerSessionId.trim();
    if (!providerSessionId || providerSessionId.length > MAX_BROWSER_SESSION_ID_LENGTH) {
      throw new Error("Firecrawl browser session ID is invalid");
    }
    const binding = await requireThreadBinding(ctx, args.threadId);
    if (binding.scoutId !== args.scoutId) throw new Error("Lab browser Scout does not match");
    const existing = await ctx.db
      .query("scoutLabBrowserSessions")
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
        throw new Error("Firecrawl session is not active for this Lab thread");
      }
      return { sessionId: existing._id, captureOperations: true as const };
    }
    const latest = await ctx.db
      .query("scoutLabBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (index) => index.eq("threadId", args.threadId))
      .order("desc")
      .first();
    if (latest?.lifecycle.kind === "active") {
      throw new Error("This Lab thread already has an active browser session");
    }
    const sequence = (latest?.sequence ?? 0) + 1;
    if (sequence > MAX_BROWSER_SESSIONS_PER_THREAD) {
      throw new Error(`A Lab thread can have at most ${MAX_BROWSER_SESSIONS_PER_THREAD} sessions`);
    }
    return {
      sessionId: await ctx.db.insert("scoutLabBrowserSessions", {
        threadId: args.threadId,
        scoutId: args.scoutId,
        sequence,
        provider: "firecrawl",
        providerSessionId,
        profileName: args.profileName,
        viewport: LAB_BROWSER_VIEWPORT,
        nextOperationSequence: 1,
        lifecycle: { kind: "active", openedAtMs: Date.now() },
      }),
      captureOperations: true as const,
    };
  },
});

export const prepareOperation = internalMutation({
  args: {
    sessionId: v.id("scoutLabBrowserSessions"),
    toolCallId: v.string(),
    action: taskBrowserActionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const toolCallId = args.toolCallId.trim();
    if (!toolCallId || toolCallId.length > MAX_BROWSER_TOOL_CALL_ID_LENGTH) {
      throw new Error("Browser tool call ID is invalid");
    }
    const session = await ctx.db.get("scoutLabBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind !== "active") {
      throw new Error("Active Lab browser session not found");
    }
    const duplicate = await ctx.db
      .query("scoutLabBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", session._id).eq("toolCallId", toolCallId),
      )
      .unique();
    if (duplicate) return false;
    const sequence = session.nextOperationSequence;
    if (sequence > MAX_BROWSER_OPERATIONS) {
      throw new Error(`A browser session can have at most ${MAX_BROWSER_OPERATIONS} operations`);
    }
    await ctx.db.patch("scoutLabBrowserSessions", session._id, {
      nextOperationSequence: sequence + 1,
    });
    await ctx.db.insert("scoutLabBrowserOperations", {
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
    sessionId: v.id("scoutLabBrowserSessions"),
    toolCallId: v.string(),
    outcome: taskBrowserOutcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operation = await ctx.db
      .query("scoutLabBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", args.sessionId).eq("toolCallId", args.toolCallId.trim()),
      )
      .unique();
    if (!operation) throw new Error("Lab browser operation not found");
    if (operation.state.kind !== "prepared") return null;
    const settledAtMs = Date.now();
    switch (args.outcome.kind) {
      case "applied":
      case "applied_snapshot_failed":
        await ctx.db.patch("scoutLabBrowserOperations", operation._id, {
          state: { kind: args.outcome.kind, settledAtMs, telemetry: args.outcome.telemetry },
        });
        break;
      case "failed_before_dispatch":
      case "indeterminate_after_dispatch":
        await ctx.db.patch("scoutLabBrowserOperations", operation._id, {
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
    sessionId: v.id("scoutLabBrowserSessions"),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutLabBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind === "closed") return null;
    await ctx.db.patch("scoutLabBrowserSessions", session._id, {
      lifecycle: {
        kind: "closed",
        openedAtMs: session.lifecycle.openedAtMs,
        closedAtMs: Date.now(),
        providerDurationMs: args.providerDurationMs,
        creditsBilled: args.creditsBilled,
      },
    });
    const liveView = await ctx.db
      .query("scoutLabLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (liveView) await ctx.db.delete(liveView._id);
    return null;
  },
});

export const setLiveView = internalMutation({
  args: { sessionId: v.id("scoutLabBrowserSessions"), liveViewUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutLabBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind !== "active") return null;
    const liveViewUrl = requireFirecrawlLiveViewUrl(args.liveViewUrl);
    const existing = await ctx.db
      .query("scoutLabLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (existing) {
      await ctx.db.replace("scoutLabLiveViews", existing._id, {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("scoutLabLiveViews", {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    }
    return null;
  },
});

export const clearLiveView = internalMutation({
  args: { sessionId: v.id("scoutLabBrowserSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const liveView = await ctx.db
      .query("scoutLabLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId))
      .unique();
    if (liveView) await ctx.db.delete(liveView._id);
    return null;
  },
});
