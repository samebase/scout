/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference, type PaginationResult } from "convex/server";
import type { Infer } from "convex/values";
import { describe, expect, test, vi } from "vite-plus/test";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { creditsEnabled, costMicrodollars } from "./creditPolicy";
import { creditSourceValidator } from "./creditsModel";
import schema from "./schema";
import { insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");

// These references become generated API entries when the wallet files are included in codegen.
const balance = makeFunctionReference<"query", Record<string, never>, unknown>("credits:balance");
const history = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  PaginationResult<Doc<"creditEntries">>
>("credits:history");
const offer = makeFunctionReference<"query", Record<string, never>, unknown>("credits:offer");
const ensureWallet = makeFunctionReference<"mutation", Record<string, never>, null>(
  "credits:ensureWallet",
);
const reserve = makeFunctionReference<
  "mutation",
  {
    sessionId: Id<"agentsApiSessions">;
    sourceKey: string;
    source: Infer<typeof creditSourceValidator>;
    maximumCostMicrodollars: number;
  },
  Id<"creditReservations">
>("credits:reserve");
const reserveSessionAi = makeFunctionReference<
  "mutation",
  { sessionId: Id<"agentsApiSessions">; sourceKey: string },
  Id<"creditReservations">
>("credits:reserveSessionAi");
const debitCumulative = makeFunctionReference<
  "mutation",
  { reservationId: Id<"creditReservations">; totalCostMicrodollars: number },
  null
>("credits:debitCumulative");
const settle = makeFunctionReference<
  "mutation",
  { reservationId: Id<"creditReservations">; costMicrodollars: number },
  null
>("credits:settle");
const release = makeFunctionReference<
  "mutation",
  { reservationId: Id<"creditReservations">; reason: string },
  null
>("credits:release");
const unresolved = makeFunctionReference<
  "mutation",
  { reservationId: Id<"creditReservations">; reason: string },
  null
>("credits:unresolved");
const recordSessionUsage = makeFunctionReference<
  "mutation",
  { sessionId: Id<"agentsApiSessions">; modelCostMicrodollars: number; webSearchCalls: number },
  null
>("credits:recordSessionUsage");
const adjustManually = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; reference: string; amountUnits: number; reason: string },
  null
>("credits:adjustManually");
const setHoldManually = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; hold: Doc<"creditWallets">["hold"] },
  null
>("credits:setHoldManually");

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
    await owner.mutation(ensureWallet, {});
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 500_000,
      reservedUnits: 0,
      availableUnits: 500_000,
    });
    const page = await owner.query(history, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]?.detail).toEqual({ kind: "signup", policyVersion: "2026-09-10" });
    await expect(backend.query(balance, {})).rejects.toThrow("Not authorized");
    const otherId = await backend.run((ctx) =>
      insertTestAccount(ctx, { email: "other@example.test" }),
    );
    const other = backend.withIdentity({ subject: `${otherId}|session` });
    expect(await other.query(balance, {})).toBeNull();
    expect(
      (await other.query(history, { paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toEqual([]);
  });

  test("rejects an unverified or deleted grant while allowing a verified pending account", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await backend.run((ctx) => ctx.db.patch(userId, { isApproved: false }));
    await owner.mutation(ensureWallet, {});
    await expect(
      backend.mutation(reserve, {
        sessionId,
        sourceKey: "pending-review",
        source: { kind: "request_check" },
        maximumCostMicrodollars: 10_000,
      }),
    ).resolves.toBeDefined();
    await backend.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: undefined }));
    await expect(owner.query(balance, {})).rejects.toThrow("Not authorized");
    await expect(
      backend.mutation(reserve, {
        sessionId,
        sourceKey: "unverified",
        source: { kind: "model" },
        maximumCostMicrodollars: 10_000,
      }),
    ).rejects.toThrow("verified");
    await backend.run((ctx) => ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() }));
    await expect(owner.mutation(ensureWallet, {})).rejects.toThrow("Not authorized");
  });

  test("serializes competing reservations and settles a provider overrun once", async () => {
    const { backend, owner, sessionId } = await setup();
    const run = (sourceKey: string) =>
      backend.mutation(reserve, {
        sessionId,
        sourceKey,
        source: { kind: "research" },
        maximumCostMicrodollars: 300_000,
      });
    const results = await Promise.allSettled([run("first"), run("second")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const success = results.find((result) => result.status === "fulfilled");
    if (!success || success.status !== "fulfilled") throw new Error("Missing reservation");
    const reservationId = success.value;
    await backend.mutation(settle, { reservationId, costMicrodollars: 600_000 });
    await backend.mutation(settle, { reservationId, costMicrodollars: 600_000 });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: -100_000,
      reservedUnits: 0,
    });
    await expect(run("first")).rejects.toThrow();
    await expect(
      backend.mutation(settle, { reservationId, costMicrodollars: 600_001 }),
    ).rejects.toThrow("Conflicting");
  });

  test("charges cumulative reservation totals once and releases the remaining hold on final settlement", async () => {
    const { backend, owner, sessionId } = await setup();
    const reservationId = await backend.mutation(reserve, {
      sessionId,
      sourceKey: "model-run-1",
      source: { kind: "model" },
      maximumCostMicrodollars: 300_000,
    });
    await backend.mutation(debitCumulative, { reservationId, totalCostMicrodollars: 20_000 });
    await backend.mutation(debitCumulative, { reservationId, totalCostMicrodollars: 20_000 });
    await backend.mutation(debitCumulative, { reservationId, totalCostMicrodollars: 50_000 });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 450_000,
      reservedUnits: 250_000,
      availableUnits: 200_000,
    });
    await expect(
      backend.mutation(debitCumulative, { reservationId, totalCostMicrodollars: 40_000 }),
    ).rejects.toThrow("cannot decrease");
    await backend.mutation(settle, { reservationId, costMicrodollars: 50_000 });
    await backend.mutation(settle, { reservationId, costMicrodollars: 50_000 });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 450_000,
      reservedUnits: 0,
    });
    const entries = await owner.query(history, { paginationOpts: { numItems: 10, cursor: null } });
    expect(entries.page.map((entry) => entry.amountUnits).sort((a, b) => a - b)).toEqual([
      -30_000, -20_000, 500_000,
    ]);
  });

  test("keeps unresolved holds and requires explicit evidence before release", async () => {
    const { backend, owner, sessionId } = await setup();
    const reservationId = await backend.mutation(reserve, {
      sessionId,
      sourceKey: "browser-run",
      source: { kind: "browser" },
      maximumCostMicrodollars: 10_000,
    });
    await backend.mutation(unresolved, {
      reservationId,
      reason: "Provider timed out after dispatch",
    });
    expect(await owner.query(balance, {})).toMatchObject({ reservedUnits: 10_000 });
    await expect(backend.mutation(release, { reservationId, reason: "" })).rejects.toThrow(
      "evidence",
    );
    await backend.mutation(release, {
      reservationId,
      reason: "Provider confirmed no billable work",
    });
    await backend.mutation(release, {
      reservationId,
      reason: "Provider confirmed no billable work",
    });
    expect(await owner.query(balance, {})).toMatchObject({ reservedUnits: 0 });
    await expect(backend.mutation(settle, { reservationId, costMicrodollars: 1 })).rejects.toThrow(
      "released",
    );
  });

  test("charges monotonic session model and hosted search totals atomically", async () => {
    const { backend, owner, sessionId } = await setup();
    await owner.mutation(ensureWallet, {});
    const reserveId = await backend.mutation(reserveSessionAi, {
      sessionId,
      sourceKey: "run-1",
    });
    expect(await owner.query(balance, {})).toMatchObject({ reservedUnits: 50_000 });
    await expect(
      backend.mutation(debitCumulative, { reservationId: reserveId, totalCostMicrodollars: 1 }),
    ).rejects.toThrow("admission hold cannot be billed");
    const first = { sessionId, modelCostMicrodollars: 10_000, webSearchCalls: 2 };
    await backend.mutation(recordSessionUsage, first);
    await backend.mutation(recordSessionUsage, first);
    await backend.mutation(recordSessionUsage, {
      sessionId,
      modelCostMicrodollars: 8_000,
      webSearchCalls: 1,
    });
    await backend.mutation(recordSessionUsage, {
      sessionId,
      modelCostMicrodollars: 12_000,
      webSearchCalls: 3,
    });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 458_000,
      reservedUnits: 50_000,
    });
    await backend.mutation(settle, { reservationId: reserveId, costMicrodollars: 0 });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 458_000,
      reservedUnits: 0,
    });
    const session = await backend.run((ctx) => ctx.db.get(sessionId));
    expect(session).toMatchObject({
      chargedModelMicrodollars: 12_000,
      chargedWebSearchCalls: 3,
    });
    const entries = await owner.query(history, { paginationOpts: { numItems: 10, cursor: null } });
    expect(entries.page.map((entry) => entry.amountUnits).sort((a, b) => a - b)).toEqual([
      -20_000, -10_000, -10_000, -2_000, 500_000,
    ]);
  });

  test("lets a running task use its own admission hold and stops when its balance is exhausted", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    await owner.mutation(ensureWallet, {});
    const reservationId = await backend.mutation(reserveSessionAi, {
      sessionId,
      sourceKey: "run-with-little-credit",
    });
    await backend.run((ctx) =>
      ctx.db.patch(sessionId, { creditAdmissionReservationId: reservationId }),
    );
    await backend.mutation(adjustManually, {
      userId,
      reference: "reduce-to-reserved-balance",
      amountUnits: -450_000,
      reason: "Test remaining admission funds",
    });
    expect(
      await backend.mutation(recordSessionUsage, {
        sessionId,
        modelCostMicrodollars: 0,
        webSearchCalls: 0,
      }),
    ).toBe(true);
    expect(
      await backend.mutation(recordSessionUsage, {
        sessionId,
        modelCostMicrodollars: 50_000,
        webSearchCalls: 0,
      }),
    ).toBe(false);
    expect(await owner.query(balance, {})).toMatchObject({ balanceUnits: 0 });
  });

  test("manual adjustments replay safely and a hold blocks new reservations without blocking settlement", async () => {
    const { backend, owner, userId, sessionId } = await setup();
    const reservationId = await backend.mutation(reserve, {
      sessionId,
      sourceKey: "pending",
      source: { kind: "web_search" },
      maximumCostMicrodollars: 10_000,
    });
    const adjustment = {
      userId,
      reference: "support-case-1",
      amountUnits: 12_345,
      reason: "Corrected duplicate charge",
    };
    await backend.mutation(adjustManually, adjustment);
    await backend.mutation(adjustManually, adjustment);
    await expect(
      backend.mutation(adjustManually, { ...adjustment, amountUnits: 2 }),
    ).rejects.toThrow("Conflicting");
    await backend.mutation(setHoldManually, {
      userId,
      hold: { kind: "held", reason: "Account under review" },
    });
    await expect(
      backend.mutation(reserve, {
        sessionId,
        sourceKey: "blocked",
        source: { kind: "web_search" },
        maximumCostMicrodollars: 1,
      }),
    ).rejects.toThrow("CREDIT_HOLD");
    await backend.mutation(settle, { reservationId, costMicrodollars: 5_000 });
    expect(await owner.query(balance, {})).toMatchObject({
      balanceUnits: 507_345,
      reservedUnits: 0,
    });
  });

  test("usage gate defaults off, and pricing input rounds microdollars upward", async () => {
    const original = process.env["CREDITS_ENABLED"];
    delete process.env["CREDITS_ENABLED"];
    try {
      const { owner } = await setup();
      expect(creditsEnabled()).toBe(false);
      expect(await owner.query(offer, {})).toMatchObject({ usageEnabled: false });
      vi.stubEnv("CREDITS_ENABLED", "true");
      expect(creditsEnabled()).toBe(true);
      expect(await owner.query(offer, {})).toMatchObject({ usageEnabled: true });
    } finally {
      vi.unstubAllEnvs();
      if (original === undefined) delete process.env["CREDITS_ENABLED"];
      else process.env["CREDITS_ENABLED"] = original;
    }
    expect(costMicrodollars(0.0000011)).toBe(2);
    expect(() => costMicrodollars(Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
