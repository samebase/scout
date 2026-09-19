/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { creditsEnabled, costMicrodollars } from "./creditPolicy";
import schema from "./schema";
import { insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.stubEnv("CREDITS_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const backend = convexTest(schema, modules);
  const { userId, sessionId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "credits@example.test" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Credit test",
      websiteIdentity: { firstName: "Credit", lastName: "Test" },
      slug: "credit-test",
      status: "active",
      agentMail: { inboxId: "credit-test", address: "credit@example.test" },
      firecrawl: { profileName: "credit-test" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: "Credit test",
      title: "Credit test",
      model: "gpt-5.6-luna",
      state: { kind: "running" },
      active: true,
      nextSequence: 0,
      browser: null,
      usage: null,
    });
    return { userId, sessionId };
  });
  const owner = backend.withIdentity({ subject: `${userId}|session` });
  return { backend, owner, userId, sessionId };
}

describe("credit wallet", () => {
  test("grants 50 credits once on verified sign-in and serves only the owner's history", async () => {
    const { backend, owner, userId } = await setup();
    await backend.mutation(internal.auth.store, {
      args: { type: "signIn", userId, generateTokens: false },
    });
    await backend.mutation(internal.auth.store, {
      args: { type: "signIn", userId, generateTokens: false },
    });
    await owner.mutation(api.credits.ensureWallet, {});
    expect(await owner.query(api.credits.balance, {})).toEqual({
      balanceUnits: 500_000,
      hold: { kind: "clear" },
    });
    const page = await owner.query(api.credits.history, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]?.detail).toEqual({ kind: "signup", policyVersion: "2026-09-20" });
    await expect(backend.query(api.credits.balance, {})).rejects.toThrow("Not authorized");
    const otherId = await backend.run((ctx) =>
      insertTestAccount(ctx, { email: "other@example.test" }),
    );
    const other = backend.withIdentity({ subject: `${otherId}|session` });
    expect(await other.query(api.credits.balance, {})).toBeNull();
    expect(
      (await other.query(api.credits.history, { paginationOpts: { numItems: 10, cursor: null } }))
        .page,
    ).toEqual([]);
  });

  test("rejects unverified users while allowing a verified pending account", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await backend.run((ctx) => ctx.db.patch(userId, { isApproved: false }));
    await owner.mutation(api.credits.ensureWallet, {});
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).resolves.toBe(
      true,
    );
    await backend.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: undefined }));
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).rejects.toThrow(
      "verified",
    );
    await backend.run((ctx) => ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() }));
    await expect(owner.mutation(api.credits.ensureWallet, {})).rejects.toThrow("Not authorized");
  });

  test("allows concurrent work to overdraw and blocks more work until a top-up", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await owner.mutation(api.credits.ensureWallet, {});
    await backend.mutation(internal.credits.adjustManually, {
      userId,
      reference: "small-balance",
      amountUnits: -499_999,
      reason: "Test one unit remaining",
    });
    await Promise.all([
      backend.mutation(internal.credits.checkBalance, { sessionId }),
      backend.mutation(internal.credits.checkBalance, { sessionId }),
    ]);
    for (const sourceKey of ["first-call", "second-call"]) {
      await backend.mutation(internal.credits.recordUsage, {
        userId,
        sessionId,
        sourceKey,
        kind: "model",
        totalCostMicrodollars: 20,
      });
    }
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: -39 });
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).rejects.toThrow(
      "INSUFFICIENT_CREDITS",
    );
    await backend.mutation(internal.credits.adjustManually, {
      userId,
      reference: "top-up",
      amountUnits: 100,
      reason: "Test replenished balance",
    });
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).resolves.toBe(
      true,
    );
  });

  test("charges cumulative usage once, including duplicate and out-of-order reports", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await owner.mutation(api.credits.ensureWallet, {});
    const usage = { userId, sessionId, sourceKey: "model-run", kind: "model" as const };
    await Promise.all([
      backend.mutation(internal.credits.recordUsage, { ...usage, totalCostMicrodollars: 20_000 }),
      backend.mutation(internal.credits.recordUsage, { ...usage, totalCostMicrodollars: 20_000 }),
    ]);
    await backend.mutation(internal.credits.recordUsage, {
      ...usage,
      totalCostMicrodollars: 50_000,
    });
    await backend.mutation(internal.credits.recordUsage, {
      ...usage,
      totalCostMicrodollars: 40_000,
    });
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 450_000 });
    const entries = await owner.query(api.credits.history, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(entries.page.map((entry) => entry.amountUnits).sort((a, b) => a - b)).toEqual([
      -30_000, -20_000, 500_000,
    ]);
    const otherId = await backend.run((ctx) =>
      insertTestAccount(ctx, { email: "other@example.test" }),
    );
    await expect(
      backend.mutation(internal.credits.recordUsage, {
        ...usage,
        userId: otherId,
        totalCostMicrodollars: 60_000,
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      backend.mutation(internal.credits.recordUsage, {
        ...usage,
        kind: "research",
        totalCostMicrodollars: 60_000,
      }),
    ).rejects.toThrow("different operation");
  });

  test("manual adjustments replay safely and an account hold does not block actual usage charges", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await owner.mutation(api.credits.ensureWallet, {});
    const adjustment = {
      userId,
      reference: "support-case-1",
      amountUnits: 12_345,
      reason: "Corrected duplicate charge",
    };
    await backend.mutation(internal.credits.adjustManually, adjustment);
    await backend.mutation(internal.credits.adjustManually, adjustment);
    await expect(
      backend.mutation(internal.credits.adjustManually, {
        ...adjustment,
        amountUnits: 2,
      }),
    ).rejects.toThrow("Conflicting");
    await backend.mutation(internal.credits.setHoldManually, {
      userId,
      hold: { kind: "held", reason: "Account under review" },
    });
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).rejects.toThrow(
      "CREDIT_HOLD",
    );
    await backend.mutation(internal.credits.recordUsage, {
      userId,
      sessionId,
      sourceKey: "already-incurred",
      kind: "web_search",
      totalCostMicrodollars: 5_000,
    });
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 507_345 });
  });

  test("usage gate defaults off and disabled billing doesn't prevent work on an empty wallet", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await owner.mutation(api.credits.ensureWallet, {});
    await backend.mutation(internal.credits.adjustManually, {
      userId,
      reference: "empty",
      amountUnits: -500_000,
      reason: "Empty wallet",
    });
    await expect(backend.mutation(internal.credits.checkBalance, { sessionId })).rejects.toThrow();
    delete process.env["CREDITS_ENABLED"];
    expect(creditsEnabled()).toBe(false);
    expect(await owner.query(api.credits.offer, {})).toMatchObject({ usageEnabled: false });
    expect(await backend.mutation(internal.credits.checkBalance, { sessionId })).toBe(false);
    expect(costMicrodollars(0.0000011)).toBe(2);
    expect(() => costMicrodollars(Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
