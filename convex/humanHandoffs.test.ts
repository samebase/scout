/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { HUMAN_HANDOFF_ACTIVE_MS, HUMAN_HANDOFF_CLAIM_MS } from "./humanHandoffs";
import { activeBrowserForChat } from "./scout/chatAccess";
import { hashHumanHandoffAccessToken } from "./scout/lib/humanHandoffAccess";

const modules = import.meta.glob("./**/*.ts");
const accessToken = `hh1_${"A".repeat(43)}`;
const accessTokenHash = hashHumanHandoffAccessToken(accessToken);
const deliveryArgs = {
  emailSubject: "A browser check needs you",
  emailNote: "Please complete the waiting browser check, then return control.",
};
const browserProvider = vi.hoisted(() => ({
  list: vi.fn(),
  close: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("./scout/lib/firecrawl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scout/lib/firecrawl")>();
  return {
    ...actual,
    createFirecrawlClient: () => ({ listBrowsers: browserProvider.list }),
    closeFirecrawlBrowserSession: browserProvider.close,
  };
});

vi.mock("./scout/playwrightBrowser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scout/playwrightBrowser")>();
  return {
    ...actual,
    connectPlaywrightBrowser: async () => ({ snapshot: browserProvider.snapshot }),
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
  browserProvider.list.mockReset().mockResolvedValue({
    success: true,
    sessions: [
      {
        id: "provider-session-1",
        status: "active",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=private",
      },
    ],
  });
  browserProvider.close.mockReset().mockResolvedValue({
    success: true,
    sessionDurationMs: 12_000,
    creditsBilled: 4,
  });
  browserProvider.snapshot.mockReset().mockResolvedValue('- button "Continue" [ref=e1]');
});

afterEach(() => {
  vi.useRealTimers();
});

async function setupContext() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Conrad Scout",
      websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
      slug: "conrad",
      status: "active",
      agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
      firecrawl: { profileName: "conrad-profile" },
    });
    const threadId = "thread-1";
    const chatId = await ctx.db.insert("scoutChats", {
      userId,
      scoutId,
      threadId,
      createdAt: Date.now(),
    });
    const turnId = await ctx.db.insert("scoutTurns", {
      threadId: "thread-1",
      order: 0,
      promptMessageId: "prompt-1",
      scoutId,
      model: "qwen/qwen3.7-flash",
      startedAt: Date.now(),
      state: { kind: "pending", leaseExpiresAt: Date.now() + 8 * 60 * 1_000 },
    });
    const sessionId = await ctx.db.insert("scoutBrowserSessions", {
      threadId,
      scoutId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "provider-session-1",
      profileName: "conrad-profile",
      viewport: { width: 1_280, height: 800 },
      nextOperationSequence: 1,
      lifecycle: { kind: "active", openedAtMs: Date.now() },
    });
    return { userId, chatId, scoutId, threadId, turnId, sessionId };
  });
  const owner = backend.withIdentity({ subject: `${ids.userId}|test-session` });
  return { backend, owner, ...ids };
}

async function setup() {
  const context = await setupContext();
  const requested = await context.backend.mutation(internal.humanHandoffs.request, {
    promptMessageId: "prompt-1",
    reason: "  GitHub   requires a CAPTCHA.  ",
    accessTokenHash,
    ...deliveryArgs,
  });
  return { ...context, requested };
}

async function claim(
  backend: Awaited<ReturnType<typeof setup>>["backend"],
  handoffId: Awaited<ReturnType<typeof setup>>["requested"]["handoffId"],
) {
  return await backend.mutation(internal.humanHandoffs.claimAuthorized, {
    handoffId,
    accessTokenHash,
  });
}

describe("human handoffs", () => {
  test("keeps the Scout busy after pausing and while a continued handoff is closing", async () => {
    const { backend, owner, requested, scoutId, sessionId, turnId } = await setup();
    await backend.mutation(internal.scout.turns.completeHumanHandoffPause, {
      promptMessageId: "prompt-1",
      usage: {},
    });
    await expect(owner.query(api.scout.chats.getScoutActivity, { scoutId })).resolves.toEqual({
      active: true,
    });
    await claim(backend, requested.handoffId);
    await backend.mutation(internal.humanHandoffs.continueAuthorized, {
      handoffId: requested.handoffId,
      accessTokenHash,
    });
    await backend.mutation(internal.scout.browserSessions.close, {
      sessionId,
      providerDurationMs: 1_000,
      creditsBilled: 1,
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state)).toMatchObject({
      kind: "completed",
      usage: {},
      firecrawlCredits: 1,
      firecrawlDurationMs: 1_000,
    });
    await expect(owner.query(api.scout.chats.getScoutActivity, { scoutId })).resolves.toEqual({
      active: true,
    });
  });

  test("reserves a failed handoff's browser until cleanup and rejects stale manual dispatch", async () => {
    const { backend, scoutId, threadId, sessionId } = await setup();
    await backend.mutation(internal.scout.turns.fail, {
      promptMessageId: "prompt-1",
      failure: "Generation failed",
    });
    await expect(
      backend.run(async (ctx) => activeBrowserForChat(ctx, scoutId, threadId)),
    ).rejects.toThrow("reserved for human handoff");
    await expect(
      backend.mutation(internal.scout.browserSessions.prepareOperation, {
        sessionId,
        toolCallId: "stale-manual",
        action: { kind: "execute", code: "return await browserState(page);" },
      }),
    ).rejects.toThrow("reserved for human handoff");
    await backend.mutation(internal.scout.browserSessions.close, {
      sessionId,
      providerDurationMs: null,
      creditsBilled: null,
    });
    await expect(
      backend.run(async (ctx) => activeBrowserForChat(ctx, scoutId, threadId)),
    ).resolves.toBeNull();
  });

  test("stores only the private-link digest while queuing 45-minute delivery", async () => {
    const { backend, owner, requested, sessionId, turnId, threadId } = await setup();
    const row = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    if (!row || row.status !== "available") throw new Error("Available handoff not found");

    expect(row).toMatchObject({
      reason: "GitHub requires a CAPTCHA.",
      accessTokenHash,
      status: "available",
      sessionId,
      turnId,
    });
    expect(row.claimExpiresAt - row.requestedAt).toBe(HUMAN_HANDOFF_CLAIM_MS);
    expect(JSON.stringify(row)).not.toContain("hh1_");
    const delivery = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutHumanHandoffDeliveries")
          .withIndex("by_handoff_id", (index) => index.eq("handoffId", requested.handoffId))
          .unique(),
    );
    expect(delivery).toMatchObject({
      handoffId: requested.handoffId,
      inboxId: "conrad-inbox",
      recipientEmail: ADMIN_EMAIL,
      scoutName: "Conrad Scout",
      ...deliveryArgs,
    });
    expect(JSON.stringify(delivery)).not.toMatch(/hh1_|#access=|https?:\/\//);
    expect(requested).toEqual({
      handoffId: row._id,
      created: true,
      recipientEmail: ADMIN_EMAIL,
      scoutName: "Conrad Scout",
      claimExpiresAt: row.claimExpiresAt,
    });
    await expect(owner.query(api.humanHandoffs.active, { sessionId })).resolves.toEqual({
      handoffId: requested.handoffId,
      reason: "GitHub requires a CAPTCHA.",
      requestedAt: row.requestedAt,
      expiresAt: row.claimExpiresAt,
      phase: "unclaimed",
    });
    await expect(
      backend.query(internal.humanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash: "b".repeat(64),
        now: Date.now(),
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      backend.query(internal.humanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      status: "available",
      providerSessionId: "provider-session-1",
    });
    await expect(
      owner.query(internal.humanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      status: "available",
      destination: { threadId },
    });
  });

  test("only the chat owner receives the return destination", async () => {
    const { backend, requested } = await setup();
    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherUser = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    const args = { handoffId: requested.handoffId, now: Date.now() };

    await expect(otherUser.query(internal.humanHandoffs.prepareAccess, args)).resolves.toEqual({
      status: "invalid",
    });
    const bearerPage = await otherUser.query(internal.humanHandoffs.prepareAccess, {
      ...args,
      accessTokenHash,
    });
    expect(bearerPage.status).toBe("available");
    expect(bearerPage).not.toHaveProperty("destination");
    const anonymousPage = await backend.query(internal.humanHandoffs.prepareAccess, {
      ...args,
      accessTokenHash,
    });
    expect(anonymousPage).toEqual(bearerPage);
  });

  test("repeating a request preserves its link and workflow", async () => {
    const { backend, requested, sessionId, turnId } = await setup();
    const original = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    const repeated = await backend.mutation(internal.humanHandoffs.request, {
      promptMessageId: "prompt-1",
      reason: "The same browser check.",
      accessTokenHash,
      ...deliveryArgs,
    });

    expect(repeated).toEqual({ ...requested, created: false });
    expect(await backend.run(async (ctx) => await ctx.db.get(requested.handoffId))).toEqual(
      original,
    );
    const byTurn = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutHumanHandoffs")
          .withIndex("by_turn_id", (index) => index.eq("turnId", turnId))
          .unique(),
    );
    expect(byTurn?.sessionId).toBe(sessionId);
    await expect(
      backend.mutation(internal.humanHandoffs.request, {
        promptMessageId: "prompt-1",
        reason: "The same browser check.",
        accessTokenHash: "b".repeat(64),
        ...deliveryArgs,
      }),
    ).rejects.toThrow("already");
  });

  test("rejects a browser session bound to a different Scout", async () => {
    const { backend, sessionId } = await setupContext();
    await backend.run(async (ctx) => {
      const otherScoutId = await ctx.db.insert("scouts", {
        displayName: "Mara Scout",
        websiteIdentity: { firstName: "Mara", lastName: "Scout" },
        slug: "mara",
        status: "active",
        agentMail: { inboxId: "mara-inbox", address: "mara@example.test" },
        firecrawl: { profileName: "mara-profile" },
      });
      await ctx.db.patch("scoutBrowserSessions", sessionId, { scoutId: otherScoutId });
    });

    await expect(
      backend.mutation(internal.humanHandoffs.request, {
        promptMessageId: "prompt-1",
        reason: "CAPTCHA",
        accessTokenHash,
        ...deliveryArgs,
      }),
    ).rejects.toThrow("Active Scout browser session not found");
  });

  test("does not authorize a handoff after its session moves to another chat", async () => {
    const { backend, owner, requested, sessionId } = await setup();
    await backend.run(async (ctx) => {
      await ctx.db.patch("scoutBrowserSessions", sessionId, { threadId: "different-thread" });
    });

    await expect(
      owner.query(internal.humanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash,
        now: Date.now(),
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(owner.query(api.humanHandoffs.active, { sessionId })).resolves.toBeNull();
    await expect(
      backend.mutation(internal.scout.turns.completeHumanHandoffPause, {
        promptMessageId: "prompt-1",
        usage: {},
      }),
    ).rejects.toThrow("Active human handoff not found");
  });

  test("first valid open starts a separate five-minute control window", async () => {
    const { backend, owner, requested, sessionId } = await setup();
    const before = Date.now();
    const claimed = await claim(backend, requested.handoffId);
    expect(claimed).toMatchObject({ status: "active", expiresAt: expect.any(Number) });
    if (claimed.status !== "active") throw new Error("Handoff was not claimed");
    expect(claimed.expiresAt).toBeGreaterThanOrEqual(before + HUMAN_HANDOFF_ACTIVE_MS);
    expect(claimed.expiresAt).toBeLessThanOrEqual(Date.now() + HUMAN_HANDOFF_ACTIVE_MS);
    await expect(owner.query(api.humanHandoffs.active, { sessionId })).resolves.toMatchObject({
      expiresAt: claimed.expiresAt,
      phase: "claimed",
    });
    await expect(claim(backend, requested.handoffId)).resolves.toEqual(claimed);
  });

  test("continuation is atomic and replays the same terminal page", async () => {
    const { backend, requested } = await setup();
    await claim(backend, requested.handoffId);
    const args = { handoffId: requested.handoffId, accessTokenHash };
    const [first, second] = await Promise.all([
      backend.mutation(internal.humanHandoffs.continueAuthorized, args),
      backend.mutation(internal.humanHandoffs.continueAuthorized, args),
    ]);
    expect(first).toMatchObject({ status: "continued", continuedAt: expect.any(Number) });
    expect(second).toEqual(first);
  });

  test("completing the Scout turn preserves the available browser handoff", async () => {
    const { backend, requested, turnId } = await setup();
    await backend.mutation(internal.scout.turns.completeHumanHandoffPause, {
      promptMessageId: "prompt-1",
      usage: {},
    });
    const handoff = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    expect(handoff?.status).toBe("available");
    const turn = await backend.run(async (ctx) => await ctx.db.get(turnId));
    expect(turn?.state.kind).toBe("completed");
  });

  test("the human can return control before Scout records its paused checkpoint", async () => {
    const { backend, requested, turnId } = await setup();
    await claim(backend, requested.handoffId);
    await backend.mutation(internal.humanHandoffs.continueAuthorized, {
      handoffId: requested.handoffId,
      accessTokenHash,
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
      "pending",
    );

    await backend.mutation(internal.scout.turns.completeHumanHandoffPause, {
      promptMessageId: "prompt-1",
      usage: {},
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
      "completed",
    );
    expect(await backend.run(async (ctx) => (await ctx.db.get(requested.handoffId))?.status)).toBe(
      "continued",
    );
  });

  test("unopened and claimed windows expire independently", async () => {
    const unopened = await setup();
    await unopened.backend.run(async (ctx) => {
      await ctx.db.patch(unopened.requested.handoffId, { claimExpiresAt: Date.now() - 1 });
    });
    await expect(
      unopened.backend.mutation(internal.humanHandoffs.expire, {
        handoffId: unopened.requested.handoffId,
      }),
    ).resolves.toBe("expired");
    const unopenedPage = await unopened.backend.query(internal.humanHandoffs.prepareAccess, {
      handoffId: unopened.requested.handoffId,
      accessTokenHash,
      now: Date.now(),
    });
    expect(unopenedPage).toMatchObject({ status: "expired", claimed: false });

    const opened = await setup();
    await claim(opened.backend, opened.requested.handoffId);
    await opened.backend.run(async (ctx) => {
      await ctx.db.patch(opened.requested.handoffId, { expiresAt: Date.now() - 1 });
    });
    await expect(
      opened.backend.mutation(internal.humanHandoffs.expire, {
        handoffId: opened.requested.handoffId,
      }),
    ).resolves.toBe("expired");
    const openedPage = await opened.backend.query(internal.humanHandoffs.prepareAccess, {
      handoffId: opened.requested.handoffId,
      accessTokenHash,
      now: Date.now(),
    });
    expect(openedPage).toMatchObject({ status: "expired", claimed: true });
  });

  test("an unexpected turn failure fails the open handoff", async () => {
    const { backend, requested } = await setup();
    await backend.mutation(internal.scout.turns.fail, {
      promptMessageId: "prompt-1",
      failure: "generation failed",
    });
    const handoff = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    expect(handoff).toMatchObject({ status: "failed", failure: "scout_failed" });
  });

  test.each(["continue first", "failure first"])(
    "Continue racing with a turn failure stays failed: %s",
    async (ordering) => {
      const { backend, requested, turnId } = await setup();
      await claim(backend, requested.handoffId);
      const continuationArgs = { handoffId: requested.handoffId, accessTokenHash };
      if (ordering === "continue first") {
        await backend.mutation(internal.humanHandoffs.continueAuthorized, continuationArgs);
      }
      await backend.mutation(internal.scout.turns.fail, {
        promptMessageId: "prompt-1",
        failure: "generation failed after sending the handoff",
      });

      await expect(
        backend.mutation(internal.humanHandoffs.continueAuthorized, continuationArgs),
      ).resolves.toMatchObject({ status: "failed", failure: "scout_failed" });
      await backend.mutation(internal.scout.turns.completeHumanHandoffPause, {
        promptMessageId: "prompt-1",
        usage: {},
      });
      const handoff = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
      expect(handoff).toMatchObject({
        status: "failed",
        failure: "scout_failed",
        claimed: true,
        turnId,
      });
      expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
        "failed",
      );
    },
  );

  test("a failed source turn releases the paused workflow, closes its browser, and never resumes", async () => {
    const { backend, requested, sessionId, threadId } = await setup();
    await claim(backend, requested.handoffId);
    await backend.mutation(internal.humanHandoffs.continueAuthorized, {
      handoffId: requested.handoffId,
      accessTokenHash,
    });
    const handoff = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    if (!handoff) throw new Error("Handoff not found");

    await backend.finishAllScheduledFunctions(() => vi.runAllTimers());
    const waiting = await backend.query(components.workflow.workflow.getStatus, {
      workflowId: handoff.workflowId,
    });
    expect(waiting.inProgress).toEqual([
      expect.objectContaining({
        step: expect.objectContaining({
          kind: "event",
          name: "humanHandoffScoutPaused",
          inProgress: true,
        }),
      }),
    ]);
    expect(browserProvider.close).not.toHaveBeenCalled();

    await backend.mutation(internal.scout.turns.fail, {
      promptMessageId: "prompt-1",
      failure: "generation failed before the pause checkpoint",
    });
    await backend.finishAllScheduledFunctions(() => vi.runAllTimers());

    const finished = await backend.query(components.workflow.workflow.getStatus, {
      workflowId: handoff.workflowId,
    });
    expect(finished.workflow.runResult).toEqual({ kind: "success", returnValue: null });
    expect(finished.inProgress).toEqual([]);
    expect(browserProvider.close).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "provider-session-1",
    );
    expect(
      await backend.run(async (ctx) => (await ctx.db.get(sessionId))?.lifecycle),
    ).toMatchObject({
      kind: "closed",
      providerDurationMs: 12_000,
      creditsBilled: 4,
    });
    const turns = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", threadId))
          .take(2),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.state.kind).toBe("failed");
  });

  test("email delivery failure terminates the handoff without changing its source turn", async () => {
    const { backend, owner, requested, sessionId, turnId } = await setup();
    const args = { handoffId: requested.handoffId };
    await expect(backend.mutation(internal.humanHandoffs.failDelivery, args)).resolves.toBe(
      "failed",
    );
    await expect(backend.mutation(internal.humanHandoffs.failDelivery, args)).resolves.toBe(
      "failed",
    );
    const handoff = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    expect(handoff).toMatchObject({
      status: "failed",
      failure: "delivery_failed",
      claimed: false,
      turnId,
    });
    await expect(owner.query(api.humanHandoffs.active, { sessionId })).resolves.toMatchObject({
      handoffId: requested.handoffId,
      phase: "delivery_failed",
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
      "pending",
    );
  });

  test("supports handoffs in long-running chats", async () => {
    const { backend, turnId, scoutId, threadId } = await setupContext();
    await backend.run(async (ctx) => {
      await ctx.db.patch("scoutTurns", turnId, { order: 50 });
      for (let order = 0; order < 50; order += 1) {
        await ctx.db.insert("scoutTurns", {
          threadId,
          order,
          promptMessageId: `previous-prompt-${order}`,
          scoutId,
          model: "qwen/qwen3.7-flash",
          startedAt: order,
          state: { kind: "completed", completedAt: order, usage: {} },
        });
      }
    });

    await expect(
      backend.mutation(internal.humanHandoffs.request, {
        promptMessageId: "prompt-1",
        reason: "CAPTCHA",
        accessTokenHash,
        ...deliveryArgs,
      }),
    ).resolves.toMatchObject({ created: true });
  });
});
