/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { describe, expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { HUMAN_HANDOFF_ACTIVE_MS, HUMAN_HANDOFF_CLAIM_MS } from "./taskHumanHandoffs";

const modules = import.meta.glob("./**/*.ts");
const accessTokenHash = "a".repeat(64);

async function setupContext() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: ADMIN_EMAIL });
    const productId = await ctx.db.insert("products", {
      name: "GitHub",
      domain: "github.com",
      primaryUrl: "https://github.com/",
    });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Conrad Scout",
      websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
      slug: "conrad",
      status: "active",
      agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
      firecrawl: { profileName: "conrad-profile" },
    });
    const taskId = await ctx.db.insert("productTasks", {
      userId,
      productId,
      instruction: "Reach the account page.",
    });
    const attemptId = await ctx.db.insert("taskAttempts", {
      taskId,
      scoutId,
      threadId: "thread-1",
      browserProfile: { kind: "fresh" },
      state: { kind: "active" },
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
    const sessionId = await ctx.db.insert("taskBrowserSessions", {
      attemptId,
      turnId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "provider-session-1",
      profileName: null,
      viewport: { width: 1_280, height: 800 },
      nextOperationSequence: 1,
      lifecycle: { kind: "active", openedAtMs: Date.now() },
    });
    return { userId, taskId, attemptId, turnId, sessionId };
  });
  const owner = backend.withIdentity({ subject: `${ids.userId}|test-session` });
  return { backend, owner, ...ids };
}

async function setup() {
  const context = await setupContext();
  const requested = await context.backend.mutation(internal.taskHumanHandoffs.request, {
    promptMessageId: "prompt-1",
    reason: "  GitHub   requires a CAPTCHA.  ",
    accessTokenHash,
  });
  return { ...context, requested };
}

async function claim(
  backend: Awaited<ReturnType<typeof setup>>["backend"],
  handoffId: Awaited<ReturnType<typeof setup>>["requested"]["handoffId"],
) {
  return await backend.mutation(internal.taskHumanHandoffs.claimAuthorized, {
    handoffId,
    accessTokenHash,
  });
}

describe("task human handoffs", () => {
  test("stores a private 45-minute link without starting the control timer", async () => {
    const { backend, owner, requested, sessionId, taskId, attemptId } = await setup();
    const row = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));
    if (!row || row.status !== "available") throw new Error("Available handoff not found");

    expect(row).toMatchObject({
      reason: "GitHub requires a CAPTCHA.",
      accessTokenHash,
      status: "available",
    });
    expect(row.claimExpiresAt - row.requestedAt).toBe(HUMAN_HANDOFF_CLAIM_MS);
    expect(JSON.stringify(row)).not.toContain("hh1_");
    await expect(owner.query(api.taskHumanHandoffs.active, { sessionId })).resolves.toEqual({
      handoffId: requested.handoffId,
      reason: "GitHub requires a CAPTCHA.",
      requestedAt: row.requestedAt,
      expiresAt: row.claimExpiresAt,
      phase: "unclaimed",
    });
    await expect(
      backend.query(internal.taskHumanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash: "b".repeat(64),
        now: Date.now(),
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      backend.query(internal.taskHumanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      status: "available",
      providerSessionId: "provider-session-1",
    });
    await expect(
      owner.query(internal.taskHumanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      status: "available",
      destination: { domain: "github.com", taskId, attemptId },
    });
  });

  test("first valid open starts a separate five-minute control window", async () => {
    const { backend, owner, requested, sessionId } = await setup();
    const before = Date.now();
    const claimed = await claim(backend, requested.handoffId);
    expect(claimed).toMatchObject({ status: "active", expiresAt: expect.any(Number) });
    if (claimed.status !== "active") throw new Error("Handoff was not claimed");
    expect(claimed.expiresAt).toBeGreaterThanOrEqual(before + HUMAN_HANDOFF_ACTIVE_MS);
    expect(claimed.expiresAt).toBeLessThanOrEqual(Date.now() + HUMAN_HANDOFF_ACTIVE_MS);
    await expect(owner.query(api.taskHumanHandoffs.active, { sessionId })).resolves.toMatchObject({
      expiresAt: claimed.expiresAt,
      phase: "claimed",
    });
  });

  test("continuation is atomic and replays the same terminal page", async () => {
    const { backend, requested } = await setup();
    await claim(backend, requested.handoffId);
    const args = { handoffId: requested.handoffId, accessTokenHash };
    const [first, second] = await Promise.all([
      backend.mutation(internal.taskHumanHandoffs.continueAuthorized, args),
      backend.mutation(internal.taskHumanHandoffs.continueAuthorized, args),
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
    await expect(
      backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("available");
    const turn = await backend.run(async (ctx) => await ctx.db.get(turnId));
    expect(turn?.state.kind).toBe("completed");
  });

  test("unopened and claimed windows expire independently", async () => {
    const unopened = await setup();
    await unopened.backend.run(async (ctx) => {
      await ctx.db.patch(unopened.requested.handoffId, { claimExpiresAt: Date.now() - 1 });
    });
    await expect(
      unopened.backend.mutation(internal.taskHumanHandoffs.expire, {
        handoffId: unopened.requested.handoffId,
      }),
    ).resolves.toBe("expired");
    const unopenedPage = await unopened.backend.query(internal.taskHumanHandoffs.prepareAccess, {
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
      opened.backend.mutation(internal.taskHumanHandoffs.expire, {
        handoffId: opened.requested.handoffId,
      }),
    ).resolves.toBe("expired");
    const openedPage = await opened.backend.query(internal.taskHumanHandoffs.prepareAccess, {
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
    await expect(
      backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("failed");
  });
});
