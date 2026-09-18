import { v } from "convex/values";
import { internal } from "../_generated/api";
import { canAccess } from "../../shared/accessModel";
import { resolveViewer } from "../access";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertCreditAdmission, reservationForSource } from "../creditLedger";
import { costMicrodollars, costUnits, creditsEnabled, currentCreditTerms } from "../creditPolicy";
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

// Firecrawl's browser price and the funded lifetime are the values used by the
// previous credit implementation. A reservation covers the provider TTL, not
// merely the time until the next Scout tool call.
const FIRECRAWL_MICRODOLLARS_PER_CREDIT = 5_000;
const FIRECRAWL_BROWSER_CREDITS_PER_MINUTE = 2;
const MAX_FUNDED_BROWSER_MINUTES = 15;
const browserSourceKey = (sequence: number) => `browser:${String(sequence).padStart(3, "0")}`;
const browserCost = (providerCredits: number) =>
  costMicrodollars((providerCredits * FIRECRAWL_MICRODOLLARS_PER_CREDIT) / 1_000_000);

async function lastBrowserReservation(ctx: QueryCtx, sessionId: Id<"agentsApiSessions">) {
  return await ctx.db
    .query("creditReservations")
    .withIndex("by_session_id_and_source_key", (q) =>
      q.eq("sessionId", sessionId).gte("sourceKey", "browser:").lt("sourceKey", "browser;"),
    )
    .order("desc")
    .first();
}

async function browserReservation(
  ctx: QueryCtx,
  sessionId: Id<"agentsApiSessions">,
  sequence: number,
) {
  return await reservationForSource(ctx, sessionId, browserSourceKey(sequence));
}

async function byProvider(ctx: Pick<QueryCtx, "db">, providerSessionId: string) {
  const browser = await ctx.db
    .query("agentsApiBrowserSessions")
    .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", providerSessionId))
    .unique();
  if (!browser) throw new Error("Browser session not found");
  return browser;
}

export const reserve = internalMutation({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.object({ reservationId: v.id("creditReservations"), durationSeconds: v.number() }),
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{
    reservationId: Id<"creditReservations">;
    durationSeconds: number;
  }> => {
    if (!creditsEnabled()) throw new Error("Browser credits are not enabled");
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
    const last = await lastBrowserReservation(ctx, sessionId);
    if (last?.state.kind === "pending")
      throw new Error("A browser reservation is already pending; inspect it before retrying");
    const sequence =
      Math.max(previous?.sequence ?? 0, last ? Number(last.sourceKey.slice(8)) : 0) + 1;
    if (sequence > MAX_BROWSER_SESSIONS_PER_THREAD)
      throw new Error(
        `A session can have at most ${MAX_BROWSER_SESSIONS_PER_THREAD} browser attempts`,
      );
    const wallet = await assertCreditAdmission(ctx, session.userId);
    const minuteCost = browserCost(FIRECRAWL_BROWSER_CREDITS_PER_MINUTE);
    const minuteUnits = costUnits(minuteCost, currentCreditTerms());
    const available = wallet.balanceUnits - wallet.reservedUnits;
    const minutes = Math.min(MAX_FUNDED_BROWSER_MINUTES, Math.floor(available / (2 * minuteUnits)));
    if (minutes < 1) throw new Error("Insufficient credits for a browser session");
    const reservationId: Id<"creditReservations"> = await ctx.runMutation(
      internal.credits.reserve,
      {
        sessionId,
        sourceKey: browserSourceKey(sequence),
        source: { kind: "browser" },
        maximumCostMicrodollars: minutes * minuteCost,
      },
    );
    return { reservationId, durationSeconds: minutes * 60 };
  },
});

export const open = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    browser: browserHandle,
    reservationId: v.optional(v.id("creditReservations")),
  },
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
    let sequence = (previous?.sequence ?? 0) + 1;
    if (creditsEnabled()) {
      if (!args.reservationId) throw new Error("Browser credit reservation is required");
      const reservation = await ctx.db.get(args.reservationId);
      if (
        !reservation ||
        reservation.sessionId !== args.sessionId ||
        reservation.source.kind !== "browser" ||
        reservation.state.kind !== "pending"
      )
        throw new Error("Browser credit reservation is not pending for this session");
      const fundedSequence = Number(reservation.sourceKey.slice(8));
      if (reservation.sourceKey !== browserSourceKey(fundedSequence) || fundedSequence < sequence)
        throw new Error("Browser credit reservation sequence is invalid");
      sequence = fundedSequence;
    }
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

async function resolveBrowserCharge(
  ctx: MutationCtx,
  reservationId: Id<"creditReservations"> | undefined,
  creditsBilled: number | null,
  providerSessionId: string,
) {
  if (!reservationId) return;
  if (creditsBilled === null) {
    await ctx.runMutation(internal.credits.unresolved, {
      reservationId,
      reason: `Firecrawl closed browser ${providerSessionId} without final credit usage`,
    });
  } else {
    await ctx.runMutation(internal.credits.settle, {
      reservationId,
      costMicrodollars: browserCost(creditsBilled),
    });
  }
}

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
    reservationId: v.optional(v.id("creditReservations")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", args.providerSessionId))
      .unique();
    if (!browser && !args.reservationId) throw new Error("Browser session not found");
    const reservation = browser
      ? await browserReservation(ctx, browser.agentsSessionId, browser.sequence)
      : args.reservationId
        ? await ctx.db.get(args.reservationId)
        : null;
    if (args.reservationId && reservation?._id !== args.reservationId)
      throw new Error("Browser credit reservation does not match this session");
    await resolveBrowserCharge(ctx, reservation?._id, args.creditsBilled, args.providerSessionId);
    if (!browser) return null;
    if (browser.lifecycle.kind === "closed") {
      if (browser.lifecycle.creditsBilled === null && args.creditsBilled !== null)
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
    const session = await ctx.db.get(browser.agentsSessionId);
    if (session?.browser?.providerSessionId === args.providerSessionId)
      await ctx.db.patch(session._id, { browser: null });
    return null;
  },
});

export const unresolved = internalMutation({
  args: {
    providerSessionId: v.string(),
    reservationId: v.optional(v.id("creditReservations")),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", args.providerSessionId))
      .unique();
    const reservation = browser
      ? await browserReservation(ctx, browser.agentsSessionId, browser.sequence)
      : args.reservationId
        ? await ctx.db.get(args.reservationId)
        : null;
    if (args.reservationId && reservation?._id !== args.reservationId)
      throw new Error("Browser credit reservation does not match this session");
    if (reservation)
      await ctx.runMutation(internal.credits.unresolved, {
        reservationId: reservation._id,
        reason: `Browser ${args.providerSessionId}: ${args.reason}`,
      });
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
