/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  return backend;
}

async function setup() {
  const backend = testBackend();
  const userId = await backend.run(
    async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
  );
  const scoutId = await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug: "conrad",
        status: "active",
        agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
        firecrawl: { profileName: "conrad-profile" },
      }),
  );
  const admin = backend.withIdentity({ subject: `${userId}|test-session` });
  const product = await admin.mutation(api.products.create, {
    url: "cloudflare.com",
    name: "Cloudflare",
  });
  return { backend, admin, scoutId, productId: product.productId };
}

async function taskTurn(backend: ReturnType<typeof testBackend>, threadId: string) {
  return await backend.run(
    async (ctx) =>
      await ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", threadId))
        .order("desc")
        .first(),
  );
}

async function insertClosedTaskSession(
  backend: ReturnType<typeof testBackend>,
  args: { attemptId: Id<"taskAttempts">; turnId: Id<"scoutTurns"> },
) {
  await backend.run(async (ctx) => {
    await ctx.db.insert("taskBrowserSessions", {
      attemptId: args.attemptId,
      turnId: args.turnId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: `closed-${args.turnId}`,
      profileName: null,
      viewport: { width: 1_280, height: 800 },
      nextOperationSequence: 1,
      lifecycle: {
        kind: "closed",
        openedAtMs: 1,
        closedAtMs: 2,
        providerDurationMs: 1,
        creditsBilled: 1,
      },
    });
  });
}

describe("Product Tasks", () => {
  it("stores one editable instruction and creates a fresh Agent attempt", async () => {
    const { backend, admin, scoutId, productId } = await setup();
    const task = await admin.mutation(api.tasks.create, {
      productId,
      instruction:
        "Use Conrad's Cloudflare account, finish onboarding, and tell me what to try next.",
    });
    const started = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "scout", scoutId },
    });
    const attempts = await admin.query(api.tasks.listAttempts, { taskId: task.taskId });
    expect(attempts).toEqual([
      expect.objectContaining({
        attemptId: started.attemptId,
        browserProfile: { kind: "scout", profileName: "conrad-profile" },
        state: { kind: "active" },
        latestTurnState: expect.objectContaining({ kind: "pending" }),
        turnCount: 1,
      }),
    ]);
    const turn = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (index) =>
            index.eq("threadId", attempts[0]!.threadId),
          )
          .unique(),
    );
    expect(turn).not.toBeNull();
    const context = await admin.query(internal.tasks.runtimeContext, {
      promptMessageId: turn!.promptMessageId,
    });
    expect(context).toEqual(
      expect.objectContaining({
        kind: "task",
        taskId: task.taskId,
        attemptId: started.attemptId,
        scoutId,
        product: expect.objectContaining({ domain: "cloudflare.com" }),
      }),
    );
  });

  it("keeps retries as separate attempts and follow-ups as turns in one attempt", async () => {
    const { backend, admin, scoutId, productId } = await setup();
    const task = await admin.mutation(api.tasks.create, {
      productId,
      instruction: "Open Cloudflare and reach a usable dashboard.",
    });
    const first = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "fresh" },
    });
    const firstTurn = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_scout_id_and_state_kind", (index) =>
            index.eq("scoutId", scoutId).eq("state.kind", "pending"),
          )
          .unique(),
    );
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: firstTurn!.promptMessageId,
      usage: {},
    });
    await admin.mutation(api.tasks.continueAttempt, {
      attemptId: first.attemptId,
      prompt: "Now inspect the onboarding checklist.",
    });
    await expect(
      admin.query(api.tasks.listTurns, { attemptId: first.attemptId }),
    ).resolves.toHaveLength(2);

    const followUp = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_scout_id_and_state_kind", (index) =>
            index.eq("scoutId", scoutId).eq("state.kind", "pending"),
          )
          .unique(),
    );
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: followUp!.promptMessageId,
      usage: {},
    });
    const retry = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "scout", scoutId },
    });
    expect(retry.attemptId).not.toBe(first.attemptId);
    await expect(
      admin.query(api.tasks.listAttempts, { taskId: task.taskId }),
    ).resolves.toHaveLength(2);
  });

  it("resolves an Attempt independently from its latest Turn and makes retries idempotent", async () => {
    const { backend, admin, scoutId, productId } = await setup();
    const task = await admin.mutation(api.tasks.create, {
      productId,
      instruction: "Create the account and confirm the dashboard is usable.",
    });
    const started = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "fresh" },
    });
    const attempt = await admin.query(api.tasks.listAttempts, { taskId: task.taskId });
    const turn = await taskTurn(backend, attempt[0]!.threadId);
    expect(turn).not.toBeNull();

    await expect(
      admin.mutation(internal.tasks.resolveAttempt, {
        promptMessageId: turn!.promptMessageId,
        state: { kind: "completed", conclusion: "The dashboard was verified." },
      }),
    ).rejects.toThrow("Close the task browser session");
    await insertClosedTaskSession(backend, {
      attemptId: started.attemptId,
      turnId: turn!._id,
    });
    const firstResolution = await admin.mutation(internal.tasks.resolveAttempt, {
      promptMessageId: turn!.promptMessageId,
      state: { kind: "completed", conclusion: "The dashboard was verified." },
    });
    expect(firstResolution).toEqual({
      kind: "completed",
      conclusion: "The dashboard was verified.",
      resolvedAt: expect.any(Number),
    });
    await expect(
      admin.mutation(internal.tasks.resolveAttempt, {
        promptMessageId: turn!.promptMessageId,
        state: { kind: "completed", conclusion: "A duplicate resolution." },
      }),
    ).resolves.toEqual(firstResolution);

    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: turn!.promptMessageId,
      usage: {},
    });
    await expect(admin.query(api.tasks.listAttempts, { taskId: task.taskId })).resolves.toEqual([
      expect.objectContaining({
        attemptId: started.attemptId,
        state: expect.objectContaining({ kind: "completed" }),
        latestTurnState: expect.objectContaining({ kind: "completed" }),
      }),
    ]);
    await expect(
      admin.mutation(api.tasks.continueAttempt, {
        attemptId: started.attemptId,
        prompt: "Try again.",
      }),
    ).rejects.toThrow("completed attempt");
    await expect(
      admin.mutation(internal.tasks.resolveAttempt, {
        promptMessageId: "stale-prompt",
        state: { kind: "blocked", conclusion: "Stale call." },
      }),
    ).rejects.toThrow("Active task Turn not found");
  });

  it("reopens blocked and abandoned Attempts only when their Turn is no longer pending", async () => {
    const { backend, admin, scoutId, productId } = await setup();
    const task = await admin.mutation(api.tasks.create, {
      productId,
      instruction: "Reach the account settings page.",
    });
    const started = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "fresh" },
    });
    const attempt = await admin.query(api.tasks.listAttempts, { taskId: task.taskId });
    const turn = await taskTurn(backend, attempt[0]!.threadId);
    expect(turn).not.toBeNull();
    await insertClosedTaskSession(backend, {
      attemptId: started.attemptId,
      turnId: turn!._id,
    });
    await admin.mutation(internal.tasks.resolveAttempt, {
      promptMessageId: turn!.promptMessageId,
      state: { kind: "blocked", conclusion: "The site requires human help." },
    });
    await expect(
      admin.mutation(api.tasks.continueAttempt, {
        attemptId: started.attemptId,
        prompt: "Continue after the block.",
      }),
    ).rejects.toThrow("current Turn");
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: turn!.promptMessageId,
      usage: {},
    });
    await admin.mutation(api.tasks.continueAttempt, {
      attemptId: started.attemptId,
      prompt: "Continue after the block.",
    });
    const reopened = await admin.query(api.tasks.listAttempts, { taskId: task.taskId });
    expect(reopened[0]).toEqual(
      expect.objectContaining({
        state: { kind: "active" },
        latestTurnState: expect.objectContaining({ kind: "pending" }),
      }),
    );
    const latestTurn = await taskTurn(backend, reopened[0]!.threadId);
    expect(latestTurn).not.toBeNull();
    await expect(
      admin.mutation(api.tasks.abandonAttempt, {
        attemptId: started.attemptId,
        conclusion: "The operator abandoned this attempt.",
      }),
    ).rejects.toThrow("Turn is pending");
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: latestTurn!.promptMessageId,
      usage: {},
    });
    await admin.mutation(api.tasks.abandonAttempt, {
      attemptId: started.attemptId,
      conclusion: "The operator abandoned this attempt.",
    });
    await expect(admin.query(api.tasks.listAttempts, { taskId: task.taskId })).resolves.toEqual([
      expect.objectContaining({
        state: {
          kind: "abandoned",
          conclusion: "The operator abandoned this attempt.",
          resolvedAt: expect.any(Number),
        },
      }),
    ]);
    await admin.mutation(api.tasks.continueAttempt, {
      attemptId: started.attemptId,
      prompt: "Reopen the abandoned attempt.",
    });
    await expect(admin.query(api.tasks.listAttempts, { taskId: task.taskId })).resolves.toEqual([
      expect.objectContaining({
        state: { kind: "active" },
        latestTurnState: expect.objectContaining({ kind: "pending" }),
      }),
    ]);
  });

  it("keeps an Attempt active when a CAPTCHA handoff expires and its Turn finishes", async () => {
    const { backend, admin, scoutId, productId } = await setup();
    const task = await admin.mutation(api.tasks.create, {
      productId,
      instruction: "Open the signup page.",
    });
    const started = await admin.mutation(api.tasks.startAttempt, {
      taskId: task.taskId,
      scoutId,
      browserProfile: { kind: "fresh" },
    });
    const attempts = await admin.query(api.tasks.listAttempts, { taskId: task.taskId });
    const turn = await taskTurn(backend, attempts[0]!.threadId);
    expect(turn).not.toBeNull();
    const sessionId = await backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("taskBrowserSessions", {
        attemptId: started.attemptId,
        turnId: turn!._id,
        sequence: 1,
        provider: "firecrawl",
        providerSessionId: "captcha-session",
        profileName: null,
        viewport: { width: 1_280, height: 800 },
        nextOperationSequence: 1,
        lifecycle: { kind: "active", openedAtMs: Date.now() },
      });
      await ctx.db.insert("taskHumanHandoffs", {
        sessionId,
        reason: "CAPTCHA",
        requestedAt: Date.now(),
        status: "waiting",
        interactiveLiveViewUrl: "https://firecrawl.example/live/captcha",
        expiresAt: Date.now() + 1000,
      });
      return sessionId;
    });
    const handoff = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("taskHumanHandoffs")
          .withIndex("by_session_id", (index) => index.eq("sessionId", sessionId))
          .unique(),
    );
    expect(handoff).not.toBeNull();
    await admin.mutation(internal.taskHumanHandoffs.expire, { handoffId: handoff!._id });
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: turn!.promptMessageId,
      usage: {},
    });
    await expect(admin.query(api.tasks.listAttempts, { taskId: task.taskId })).resolves.toEqual([
      expect.objectContaining({
        state: { kind: "active" },
        latestTurnState: expect.objectContaining({ kind: "completed" }),
      }),
    ]);
  });
});
