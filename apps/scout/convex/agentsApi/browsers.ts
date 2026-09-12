import { v } from "convex/values";
import { canAccess } from "../../shared/accessModel";
import { resolveViewer } from "../access";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import {
  browserActionValidator,
  browserClickCaptureValidator,
  browserOutcomeValidator,
  browserSessionLifecycleValidator,
  browserViewportValidator,
  MAX_BROWSER_OPERATIONS,
} from "../browserModel";
import {
  MAX_BROWSER_SESSIONS_PER_THREAD,
  replayOperationValidator,
} from "../scout/browserSessions";
import { browserHandle } from "./model";
import { visibleChat } from "../scout/chatAccess";

async function byProvider(ctx: Pick<QueryCtx, "db">, providerSessionId: string) {
  const browser = await ctx.db
    .query("agentsApiBrowserSessions")
    .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", providerSessionId))
    .unique();
  if (!browser) throw new Error("Browser session not found");
  return browser;
}

export const open = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), browser: browserHandle },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || (session.state.kind !== "running" && session.state.kind !== "starting"))
      throw new Error("Session is no longer running");
    const previous = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_agents_session_id_and_sequence", (q) =>
        q.eq("agentsSessionId", args.sessionId),
      )
      .order("desc")
      .first();
    if (session.browser || (previous && previous.lifecycle.kind !== "closed"))
      throw new Error("Close the current browser before opening another");
    const sequence = (previous?.sequence ?? 0) + 1;
    if (sequence > MAX_BROWSER_SESSIONS_PER_THREAD)
      throw new Error(`A session can have at most ${MAX_BROWSER_SESSIONS_PER_THREAD} browsers`);
    await ctx.db.insert("agentsApiBrowserSessions", {
      agentsSessionId: args.sessionId,
      sequence,
      providerSessionId: args.browser.providerSessionId,
      viewport: { width: 1280, height: 800 },
      lifecycle: { kind: "active", openedAtMs: Date.now() },
      nextOperationSequence: 1,
    });
    await ctx.db.patch(args.sessionId, { browser: args.browser });
    return null;
  },
});

export const prepareOperation = internalMutation({
  args: { providerSessionId: v.string(), toolCallId: v.string(), action: browserActionValidator },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const browser = await byProvider(ctx, args.providerSessionId);
    const session = await ctx.db.get(browser.agentsSessionId);
    if (
      browser.lifecycle.kind !== "active" ||
      !session ||
      (session.state.kind !== "running" && session.state.kind !== "starting")
    )
      throw new Error("Session is no longer running");
    const duplicate = await ctx.db
      .query("agentsApiBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (q) =>
        q.eq("sessionId", browser._id).eq("toolCallId", args.toolCallId),
      )
      .unique();
    if (duplicate) return false;
    if (browser.nextOperationSequence > MAX_BROWSER_OPERATIONS)
      throw new Error(`A browser session can have at most ${MAX_BROWSER_OPERATIONS} operations`);
    await ctx.db.insert("agentsApiBrowserOperations", {
      sessionId: browser._id,
      sequence: browser.nextOperationSequence,
      toolCallId: args.toolCallId,
      action: args.action,
      state: { kind: "prepared", preparedAtMs: Date.now() },
      clickCapture: null,
    });
    await ctx.db.patch(browser._id, { nextOperationSequence: browser.nextOperationSequence + 1 });
    return true;
  },
});

export const settleOperation = internalMutation({
  args: {
    providerSessionId: v.string(),
    toolCallId: v.string(),
    outcome: browserOutcomeValidator,
    clickCapture: browserClickCaptureValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await byProvider(ctx, args.providerSessionId);
    const operation = await ctx.db
      .query("agentsApiBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (q) =>
        q.eq("sessionId", browser._id).eq("toolCallId", args.toolCallId),
      )
      .unique();
    if (!operation) throw new Error("Browser operation not found");
    if (operation.state.kind !== "prepared") return null;
    await ctx.db.patch(operation._id, {
      state: { ...args.outcome, settledAtMs: Date.now() },
      clickCapture: args.clickCapture,
    });
    return null;
  },
});

export const close = internalMutation({
  args: {
    providerSessionId: v.string(),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await byProvider(ctx, args.providerSessionId);
    if (browser.lifecycle.kind === "closed") return null;
    await ctx.db.patch(browser._id, {
      lifecycle: {
        kind: "closed",
        openedAtMs: browser.lifecycle.openedAtMs,
        closedAtMs: Date.now(),
        providerDurationMs: args.providerDurationMs,
        creditsBilled: args.creditsBilled,
      },
    });
    const session = await ctx.db.get(browser.agentsSessionId);
    if (session?.browser?.providerSessionId === args.providerSessionId)
      await ctx.db.patch(session._id, { browser: null });
    return null;
  },
});

export const replayData = internalQuery({
  args: { sessionId: v.id("agentsApiBrowserSessions") },
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
    const viewer = await resolveViewer(ctx);
    const browser = await ctx.db.get(args.sessionId);
    if (!browser) return null;
    const session = await ctx.db.get(browser.agentsSessionId);
    if (!session) return null;
    const inspectable =
      viewer.kind === "account" &&
      session.userId === viewer.userId &&
      canAccess("access_lab", viewer.accessKeys);
    if (!inspectable && !(await visibleChat(ctx, session._id, viewer))) return null;
    const operations = await ctx.db
      .query("agentsApiBrowserOperations")
      .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", browser._id))
      .order("asc")
      .take(MAX_BROWSER_OPERATIONS);
    return {
      providerSessionId: browser.providerSessionId,
      viewport: browser.viewport,
      lifecycle: browser.lifecycle,
      operations: operations.map(({ sequence, state, clickCapture }) => ({
        sequence,
        state,
        clickCapture,
      })),
    };
  },
});
