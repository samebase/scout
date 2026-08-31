/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { HUMAN_HANDOFF_TURN_LEASE_RESERVE_MS } from "./taskHumanHandoffs";

const modules = import.meta.glob("./**/*.ts");
const accessTokenHash = "a".repeat(64);

async function setupContext(leaseDurationMs = 8 * 60 * 1_000) {
  const backend = convexTest(schema, modules);
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
      state: { kind: "pending", leaseExpiresAt: Date.now() + leaseDurationMs },
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
  const { backend } = context;
  const requested = await backend.mutation(internal.taskHumanHandoffs.request, {
    promptMessageId: "prompt-1",
    reason: "  GitHub   requires a CAPTCHA.  ",
    accessTokenHash,
  });
  return { ...context, requested };
}

describe("task human handoffs", () => {
  test("stores only a digest and authorizes either the exact bearer or task owner", async () => {
    const { backend, owner, requested, sessionId, taskId, attemptId } = await setup();
    const row = await backend.run(async (ctx) => await ctx.db.get(requested.handoffId));

    expect(row).toMatchObject({
      reason: "GitHub requires a CAPTCHA.",
      accessTokenHash,
      status: "waiting",
    });
    expect(JSON.stringify(row)).not.toContain("hh1_");
    expect(JSON.stringify(row)).not.toContain("liveview.firecrawl.dev");
    await expect(owner.query(api.taskHumanHandoffs.active, { sessionId })).resolves.toEqual({
      handoffId: requested.handoffId,
      reason: "GitHub requires a CAPTCHA.",
      requestedAt: row!.requestedAt,
      expiresAt: row!.expiresAt,
    });
    await expect(
      backend.query(internal.taskHumanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        accessTokenHash: "b".repeat(64),
        now: Date.now(),
      }),
    ).resolves.toEqual({ status: "invalid" });
    const bearerPage = await backend.query(internal.taskHumanHandoffs.prepareAccess, {
      handoffId: requested.handoffId,
      accessTokenHash,
      now: Date.now(),
    });
    expect(bearerPage).toMatchObject({
      status: "waiting",
      providerSessionId: "provider-session-1",
    });
    expect(bearerPage).not.toHaveProperty("destination");
    await expect(
      owner.query(internal.taskHumanHandoffs.prepareAccess, {
        handoffId: requested.handoffId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      status: "waiting",
      destination: { domain: "github.com", taskId, attemptId },
    });
  });

  test("continues once and returns the same terminal result on replay", async () => {
    const { backend, requested } = await setup();
    const args = { handoffId: requested.handoffId, accessTokenHash };

    const [first, second] = await Promise.all([
      backend.mutation(internal.taskHumanHandoffs.continueAuthorized, args),
      backend.mutation(internal.taskHumanHandoffs.continueAuthorized, args),
    ]);

    expect(first).toMatchObject({ status: "continued", continuedAt: expect.any(Number) });
    expect(second).toEqual(first);
  });

  test("caps the handoff before the action limit and rejects continuation after the Turn lease", async () => {
    const { backend, requested, turnId } = await setup();
    const turn = await backend.run(async (ctx) => await ctx.db.get(turnId));
    expect(turn?.state.kind).toBe("pending");
    if (!turn || turn.state.kind !== "pending") throw new Error("Pending Turn not found");
    expect(requested.expiresAt).toBe(
      turn.state.leaseExpiresAt - HUMAN_HANDOFF_TURN_LEASE_RESERVE_MS,
    );

    await backend.run(async (ctx) => {
      await ctx.db.patch(turnId, {
        state: { kind: "pending", leaseExpiresAt: Date.now() - 1 },
      });
    });
    await expect(
      backend.mutation(internal.taskHumanHandoffs.continueAuthorized, {
        handoffId: requested.handoffId,
        accessTokenHash,
      }),
    ).resolves.toMatchObject({ status: "failed", failure: "browser_ended" });
  });

  test("rejects a handoff after the action-safe deadline", async () => {
    const { backend } = await setupContext(HUMAN_HANDOFF_TURN_LEASE_RESERVE_MS - 1);

    await expect(
      backend.mutation(internal.taskHumanHandoffs.request, {
        promptMessageId: "prompt-1",
        reason: "GitHub requires a CAPTCHA.",
        accessTokenHash: "b".repeat(64),
      }),
    ).rejects.toThrow("Too little task runtime remains for human help");
  });

  test("a click after the deadline expires atomically and never continues", async () => {
    const { backend, requested } = await setup();
    const now = Date.now();
    await backend.run(async (ctx) => {
      await ctx.db.patch(requested.handoffId, {
        expiresAt: now - 1,
      });
    });

    const result = await backend.mutation(internal.taskHumanHandoffs.continueAuthorized, {
      handoffId: requested.handoffId,
      accessTokenHash,
    });

    expect(result).toMatchObject({ status: "expired", expiredAt: expect.any(Number) });
    await expect(
      backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("expired");
  });

  test("turn completion fails a waiting handoff but cannot overwrite continuation", async () => {
    const waiting = await setup();
    await waiting.backend.mutation(internal.scout.turns.complete, {
      promptMessageId: "prompt-1",
      usage: {},
    });
    await expect(
      waiting.backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: waiting.requested.handoffId,
      }),
    ).resolves.toBe("failed");

    const continued = await setup();
    await continued.backend.mutation(internal.taskHumanHandoffs.continueAuthorized, {
      handoffId: continued.requested.handoffId,
      accessTokenHash,
    });
    await continued.backend.mutation(internal.scout.turns.complete, {
      promptMessageId: "prompt-1",
      usage: {},
    });
    await expect(
      continued.backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: continued.requested.handoffId,
      }),
    ).resolves.toBe("continued");
  });

  test("stale Turn startup settles its waiting handoff", async () => {
    const { backend, requested, turnId } = await setup();
    await backend.run(async (ctx) => {
      await ctx.db.patch(turnId, {
        state: { kind: "pending", leaseExpiresAt: Date.now() - 1 },
      });
    });

    await expect(
      backend.mutation(internal.scout.turns.start, { promptMessageId: "prompt-1" }),
    ).resolves.toBe(false);
    await expect(
      backend.query(internal.taskHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("failed");
  });

  test("deadline expiry wins over later delivery and browser failures", async () => {
    for (const settle of ["delivery", "turn"] as const) {
      const { backend, requested } = await setup();
      await backend.run(async (ctx) => {
        await ctx.db.patch(requested.handoffId, {
          expiresAt: Date.now() - 1,
        });
      });

      if (settle === "delivery") {
        await backend.mutation(internal.taskHumanHandoffs.failDelivery, {
          handoffId: requested.handoffId,
        });
      } else {
        await backend.mutation(internal.scout.turns.complete, {
          promptMessageId: "prompt-1",
          usage: {},
        });
      }
      await expect(
        backend.query(internal.taskHumanHandoffs.getStatus, {
          handoffId: requested.handoffId,
        }),
      ).resolves.toBe("expired");
    }
  });
});
