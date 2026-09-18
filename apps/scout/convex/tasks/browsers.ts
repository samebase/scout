import { v } from "convex/values";
import { canAccess } from "../../shared/accessModel";
import { resolveViewer } from "../access";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertCreditAdmission, recordCreditUsage } from "../creditLedger";
import { costMicrodollars, creditsEnabled } from "../creditPolicy";
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

const FIRECRAWL_MICRODOLLARS_PER_CREDIT = 5_000;
const browserSourceKey = (sessionId: Id<"agentsApiSessions">, providerSessionId: string) =>
  `browser:${sessionId}:${providerSessionId}`;
const browserCost = (providerCredits: number) =>
  costMicrodollars((providerCredits * FIRECRAWL_MICRODOLLARS_PER_CREDIT) / 1_000_000);

async function byProvider(ctx: Pick<QueryCtx, "db">, providerSessionId: string) {
  const browser = await ctx.db
    .query("agentsApiBrowserSessions")
    .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", providerSessionId))
    .unique();
  if (!browser) throw new Error("Browser session not found");
  return browser;
}

async function assertOperationAdmission(ctx: MutationCtx, providerSessionId: string) {
  const browser = await byProvider(ctx, providerSessionId);
  const session = await ctx.db.get(browser.agentsSessionId);
  if (
    browser.lifecycle.kind !== "active" ||
    !session ||
    (session.state.kind !== "running" && session.state.kind !== "starting")
  )
    throw new Error("Session is no longer running");
  if (browser.billable) await assertCreditAdmission(ctx, session.userId);
  return browser;
}

async function openingSlot(ctx: MutationCtx, sessionId: Id<"agentsApiSessions">) {
  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    !session.active ||
    (session.state.kind !== "running" && session.state.kind !== "starting")
  )
    throw new Error("Session is no longer running");
  const previous = await ctx.db
    .query("agentsApiBrowserSessions")
    .withIndex("by_agents_session_id_and_sequence", (q) => q.eq("agentsSessionId", sessionId))
    .order("desc")
    .first();
  if (session.browser || (previous && previous.lifecycle.kind !== "closed"))
    throw new Error("Close the current browser before opening another");
  const sequence = (previous?.sequence ?? 0) + 1;
  if (sequence > MAX_BROWSER_SESSIONS_PER_THREAD)
    throw new Error(`A session can have at most ${MAX_BROWSER_SESSIONS_PER_THREAD} browsers`);
  return { session, sequence };
}

export const admit = internalMutation({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }) => {
    const { session } = await openingSlot(ctx, sessionId);
    const billable = creditsEnabled();
    if (billable) await assertCreditAdmission(ctx, session.userId);
    return billable;
  },
});

export const open = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    browser: browserHandle,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { sequence } = await openingSlot(ctx, args.sessionId);
    await ctx.db.insert("agentsApiBrowserSessions", {
      agentsSessionId: args.sessionId,
      sequence,
      providerSessionId: args.browser.providerSessionId,
      billable: creditsEnabled(),
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
    if (browser.billable) await assertCreditAdmission(ctx, session.userId);
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

export const admitOperation = internalMutation({
  args: { providerSessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { providerSessionId }) => {
    await assertOperationAdmission(ctx, providerSessionId);
    return null;
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
    orphan: v.optional(
      v.object({
        sessionId: v.id("agentsApiSessions"),
        billable: v.boolean(),
        openedAtMs: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", args.providerSessionId))
      .unique();
    if (!browser && !args.orphan) throw new Error("Browser session not found");
    if (
      browser &&
      args.orphan &&
      (browser.agentsSessionId !== args.orphan.sessionId ||
        browser.billable !== args.orphan.billable)
    )
      throw new Error("Browser attribution does not match its session");
    const sessionId = browser?.agentsSessionId ?? args.orphan?.sessionId;
    if (!sessionId) throw new Error("Browser session not found");
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Task session not found");
    if ((browser?.billable ?? args.orphan?.billable) && args.creditsBilled !== null)
      await recordCreditUsage(ctx, {
        userId: session.userId,
        sessionId,
        sourceKey: browserSourceKey(sessionId, args.providerSessionId),
        kind: "browser",
        totalCostMicrodollars: browserCost(args.creditsBilled),
      });
    if (!browser) {
      const orphan = args.orphan;
      if (!orphan) throw new Error("Browser session not found");
      const previous = await ctx.db
        .query("agentsApiBrowserSessions")
        .withIndex("by_agents_session_id_and_sequence", (q) => q.eq("agentsSessionId", sessionId))
        .order("desc")
        .first();
      await ctx.db.insert("agentsApiBrowserSessions", {
        agentsSessionId: sessionId,
        sequence: (previous?.sequence ?? 0) + 1,
        providerSessionId: args.providerSessionId,
        billable: orphan.billable,
        viewport: { width: 1280, height: 800 },
        lifecycle: {
          kind: "closed",
          openedAtMs: orphan.openedAtMs,
          closedAtMs: Date.now(),
          providerDurationMs: args.providerDurationMs,
          creditsBilled: args.creditsBilled,
        },
        nextOperationSequence: 1,
      });
      return null;
    }
    if (browser.lifecycle.kind === "closed") {
      if (
        args.creditsBilled !== null &&
        (browser.lifecycle.creditsBilled === null ||
          args.creditsBilled > browser.lifecycle.creditsBilled)
      )
        await ctx.db.patch(browser._id, {
          lifecycle: {
            ...browser.lifecycle,
            providerDurationMs: args.providerDurationMs,
            creditsBilled: args.creditsBilled,
          },
        });
      return null;
    }
    await ctx.db.patch(browser._id, {
      lifecycle: {
        kind: "closed",
        openedAtMs: browser.lifecycle.openedAtMs,
        closedAtMs: Date.now(),
        providerDurationMs: args.providerDurationMs,
        creditsBilled: args.creditsBilled,
      },
    });
    if (session?.browser?.providerSessionId === args.providerSessionId)
      await ctx.db.patch(session._id, { browser: null });
    return null;
  },
});

export const unresolved = internalMutation({
  args: {
    providerSessionId: v.string(),
    reason: v.string(),
    orphan: v.optional(
      v.object({
        sessionId: v.id("agentsApiSessions"),
        billable: v.boolean(),
        openedAtMs: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", args.providerSessionId))
      .unique();
    if (browser) {
      if (browser.lifecycle.kind !== "closed")
        await ctx.db.patch(browser._id, {
          lifecycle: { ...browser.lifecycle, cleanupError: args.reason },
        });
    } else if (args.orphan) {
      const orphan = args.orphan;
      const previous = await ctx.db
        .query("agentsApiBrowserSessions")
        .withIndex("by_agents_session_id_and_sequence", (q) =>
          q.eq("agentsSessionId", orphan.sessionId),
        )
        .order("desc")
        .first();
      await ctx.db.insert("agentsApiBrowserSessions", {
        agentsSessionId: orphan.sessionId,
        sequence: (previous?.sequence ?? 0) + 1,
        providerSessionId: args.providerSessionId,
        billable: orphan.billable,
        viewport: { width: 1280, height: 800 },
        lifecycle: {
          kind: "active",
          openedAtMs: orphan.openedAtMs,
          cleanupError: args.reason,
        },
        nextOperationSequence: 1,
      });
    }
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
    const inspectable = viewer.kind === "account" && canAccess("access_lab", viewer.accessKeys);
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
