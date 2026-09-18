/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { workflow } from "./lifecycle";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CREDITS_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "scout", address: "scout@example.test" },
      firecrawl: { profileName: "scout-profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Task",
      model: "gpt-5.6-luna",
      engine: "agents_api",
      active: true,
      state: { kind: "running" },
      nextSequence: 0,
      usage: null,
      browser: null,
    });
    return { userId, sessionId };
  });
  return { backend, ...ids, owner: backend.withIdentity({ subject: ids.userId }) };
}

test("keeps a typed credit failure through the real workflow callback and controls query", async () => {
  const t = await setup();
  await t.backend.mutation(internal.credits.grantOnSignIn, { userId: t.userId });
  await t.backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", t.userId))
      .unique();
    if (!wallet) throw new Error("Wallet is missing");
    await ctx.db.patch(wallet._id, { balanceUnits: 0 });
    const workflowId = await workflow.start(
      ctx,
      internal.tasks.lifecycle.run,
      {
        sessionId: t.sessionId,
        command: { kind: "observe" },
      },
      {
        startAsync: true,
        onComplete: internal.tasks.lifecycle.onComplete,
        context: { sessionId: t.sessionId },
      },
    );
    await ctx.db.patch(t.sessionId, {
      workflowId,
      billingEnabled: true,
    });
  });
  await t.backend.finishAllScheduledFunctions(() => {
    vi.advanceTimersByTime(100);
  });
  const controls = await t.owner.query(api.tasks.sessions.controls, { sessionId: t.sessionId });
  expect(controls.state).toEqual({
    kind: "failed",
    creditFailureCode: "INSUFFICIENT_CREDITS",
    error: "You need more credits to continue. Check your balance in Settings.",
  });
  expect(await t.backend.run((ctx) => ctx.db.get(t.sessionId))).toMatchObject({ active: false });
});

test("a late credit failure does not replace an explicit stop", async () => {
  const t = await setup();
  await t.owner.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
  await t.backend.mutation(internal.tasks.lifecycle.failForCredits, {
    sessionId: t.sessionId,
    code: "CREDIT_HOLD",
    message: "Held during shutdown",
  });
  expect(
    (await t.owner.query(api.tasks.sessions.controls, { sessionId: t.sessionId })).state,
  ).toEqual({ kind: "stopped" });
});
