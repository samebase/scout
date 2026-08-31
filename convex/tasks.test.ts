/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
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
        state: expect.objectContaining({ kind: "pending" }),
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
});
