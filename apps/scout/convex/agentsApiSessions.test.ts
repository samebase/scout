/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import { scoutIsWorking } from "./scout/chatAccess";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each(["agents_api", "convex_agent"] as const)(
  "captures paid versus free %s turns without waiting for prior usage",
  async (engine) => {
    const { backend, owner, sessionId } = await setup();
    await backend.run((ctx) =>
      ctx.db.patch(sessionId, {
        engine,
        active: false,
        state: { kind: "idle" },
        providerId: "old-free-session",
        modelTurnId: "old-free-turn",
        modelUsageIncomplete: true,
        usage: { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 },
      }),
    );
    vi.stubEnv("CREDITS_ENABLED", "true");
    await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" });
    expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
      billingEnabled: true,
      modelUsageIncomplete: true,
    });
    expect((await backend.run((ctx) => ctx.db.get(sessionId)))?.modelTurnId).toBeUndefined();
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    await backend.run((ctx) =>
      ctx.db.patch(sessionId, { active: false, modelTurnId: "paid-turn" }),
    );
    vi.stubEnv("CREDITS_ENABLED", "false");
    await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Free follow-up" });
    const free = await backend.run((ctx) => ctx.db.get(sessionId));
    expect(free?.billingEnabled).toBe(false);
    expect(free?.modelTurnId).toBeUndefined();
  },
);

it.each([true, false])(
  "resume retains the original billing choice (%s)",
  async (billingEnabled) => {
    const { backend, owner, sessionId } = await setup();
    if (billingEnabled) {
      const session = await backend.run((ctx) => ctx.db.get(sessionId));
      if (!session) throw new Error("Task missing");
      await backend.mutation(internal.credits.grantOnSignIn, { userId: session.userId });
    }
    await backend.run((ctx) =>
      ctx.db.patch(sessionId, {
        billingEnabled,
        modelTurnId: "original-turn",
        state: { kind: "waiting", message: "Sign in", callId: "call", turnId: "original-turn" },
        browser: {
          providerSessionId: "browser",
          cdpUrl: "wss://browser.test",
          liveViewUrl: null,
          interactiveLiveViewUrl: null,
          currentUrl: null,
        },
      }),
    );
    vi.stubEnv("CREDITS_ENABLED", billingEnabled ? "false" : "true");
    await owner.mutation(api.tasks.sessions.resume, {
      sessionId,
      callId: "call",
      turnId: "original-turn",
    });
    expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
      billingEnabled,
      modelTurnId: "original-turn",
      state: { kind: "checking" },
    });
  },
);

it("rejects new paid work at zero balance without preventing stop or usage reporting", async () => {
  const { backend, owner, sessionId, userId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Wallet missing");
    await ctx.db.patch(wallet._id, { balanceUnits: 0 });
    await ctx.db.patch(sessionId, {
      active: false,
      providerId: "session-test",
      modelUsageIncomplete: true,
    });
  });
  vi.stubEnv("CREDITS_ENABLED", "true");
  await expect(
    owner.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" }),
  ).rejects.toThrow("more credits");
  expect((await owner.query(api.tasks.sessions.controls, { sessionId })).canSend).toBe(true);
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
});

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "inbox", address: "scout@example.com" },
      firecrawl: { profileName: "profile" },
    });
    return { userId, scoutId };
  });
  const owner = backend.withIdentity({ subject: ids.userId });
  const sessionId = await owner.mutation(api.tasks.sessions.start, {
    scoutId: ids.scoutId,
    prompt: "Explore example.com",
    engine: "agents_api",
  });
  return { backend, owner, ...ids, sessionId };
}

it("allows admin inspection and holds the Scout for both runtimes", async () => {
  const { backend, owner, scoutId, sessionId } = await setup();
  await expect(backend.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow();
  const otherId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "nicu@samebase.com" }),
  );
  expect(
    await backend.withIdentity({ subject: otherId }).query(api.tasks.sessions.get, { sessionId }),
  ).toMatchObject({ _id: sessionId, canControl: false });
  await expect(
    owner.mutation(api.tasks.sessions.start, {
      scoutId,
      prompt: "Another run",
      engine: "agents_api",
    }),
  ).rejects.toThrow("already working");
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
  await backend.mutation(internal.tasks.sessions.update, { sessionId, active: false });
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(false);
});

it("lists and inspects a member's private Review without granting session control", async () => {
  const { backend, owner: admin, scoutId, sessionId: previousSessionId } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId: previousSessionId,
    state: { kind: "stopped" },
    active: false,
  });
  const memberId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "reviewer@example.com" }),
  );
  const member = backend.withIdentity({ subject: memberId });
  const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
    product: { kind: "review" },
    scoutId,
    prompt: "Try example.com",
    visibility: "private",
  });
  const firstPage = await admin.query(api.tasks.sessions.list, {
    paginationOpts: { numItems: 1, cursor: null },
  });
  const sessionId = firstPage.page[0]?._id;
  if (!sessionId) throw new Error("Missing Review session");
  expect(sessionId).toBe(threadId);
  expect(firstPage.isDone).toBe(false);
  const nextPage = await admin.query(api.tasks.sessions.list, {
    paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
  });
  expect(nextPage.page.map((session) => session._id)).toEqual([previousSessionId]);
  await backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      { providerItemId: "reply", kind: "assistant", text: "I opened the site.", details: "{}" },
    ],
  });
  await backend.mutation(internal.tasks.browsers.open, {
    sessionId,
    browser: {
      providerSessionId: "browser-1",
      cdpUrl: "wss://private.example.com",
      liveViewUrl: "https://example.com/view",
      interactiveLiveViewUrl: "https://example.com/control",
      currentUrl: null,
    },
  });
  expect(await admin.query(api.tasks.sessions.get, { sessionId })).toMatchObject({
    canControl: false,
    browser: { liveViewUrl: "https://example.com/view", interactiveLiveViewUrl: null },
  });
  const items = await admin.query(api.tasks.sessions.listItems, {
    sessionId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(items.page[0]?.text).toBe("I opened the site.");
  const browsers = await admin.query(api.tasks.sessions.listBrowsers, { sessionId });
  expect(browsers[0]).toMatchObject({
    liveViewUrl: "https://example.com/view",
    interactiveLiveViewUrl: null,
  });
  expect(JSON.stringify(browsers)).not.toContain("private.example.com");

  for (const viewer of [backend, member]) {
    await expect(
      viewer.query(api.tasks.sessions.list, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Not authorized");
    await expect(viewer.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      viewer.query(api.tasks.sessions.listItems, {
        sessionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Not authorized");
    await expect(viewer.query(api.tasks.sessions.listBrowsers, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
  }
  await expect(
    admin.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" }),
  ).rejects.toThrow("Session not found");
  await expect(
    admin.mutation(api.tasks.sessions.resume, { sessionId, callId: "call", turnId: "turn" }),
  ).rejects.toThrow("Session not found");
  await expect(admin.mutation(api.tasks.sessions.stop, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(member.mutation(api.tasks.sessions.stop, { sessionId })).resolves.toBeNull();
});

it("lets a member read their Review costs without Lab access or other session details", async () => {
  const { backend, owner: admin, scoutId, sessionId } = await setup();
  const memberId = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "costs@example.com" });
    await ctx.db.patch(sessionId, {
      userId,
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 },
    });
    await ctx.db.insert("scoutChats", {
      threadId: sessionId,
      runtime: { kind: "agents_api", sessionId },
      userId,
      scoutId,
      createdAt: Date.now(),
      purpose: { kind: "review" },
      visibility: "public",
    });
    return userId;
  });
  const member = backend.withIdentity({ subject: memberId });
  const costs = await member.query(api.tasks.sessions.cost, { sessionId });
  const inspected = await admin.query(api.tasks.sessions.get, { sessionId });
  expect(costs).toEqual({
    cost: inspected.cost,
    usage: inspected.usage,
    checks: inspected.checks.map(({ cost }) => ({ cost })),
    research: null,
  });
  expect(costs.cost.modelEstimateUsd).toBeCloseTo(0.0008);
  expect(costs.checks).toEqual([{ cost: 0 }]);
  await expect(member.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  await expect(backend.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow();
  await expect(admin.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await backend.run((ctx) => ctx.db.patch(memberId, { isApproved: false }));
  await expect(member.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
});

it("does not revive a stopped session or dispatch tools after stopping", async () => {
  const { backend, owner, sessionId } = await setup();
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "running" },
  });
  expect((await owner.query(api.tasks.sessions.get, { sessionId })).state.kind).toBe("stopped");
  await expect(
    backend.mutation(internal.tasks.sessions.claimCall, { sessionId, callId: "call" }),
  ).rejects.toThrow("stopped");
});

it("keeps an explicit stop when an in-flight workflow fails and still schedules cleanup", async () => {
  const { backend, owner, sessionId, scoutId } = await setup();
  const session = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  if (!session.workflowId) throw new Error("Expected a started workflow");
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  await expect(
    backend.mutation(internal.tasks.sessions.claimCall, { sessionId, callId: "late-call" }),
  ).rejects.toThrow("Session stopped before tool dispatch");

  await backend.mutation(internal.tasks.lifecycle.onComplete, {
    workflowId: session.workflowId,
    context: { sessionId },
    result: { kind: "failed", error: "Session stopped before tool dispatch" },
  });

  const stopped = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(stopped.state).toEqual({ kind: "stopped" });
  expect(stopped.cleanupJobId).toBeDefined();
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
});

it("reports workflow errors when the owner has not stopped the session", async () => {
  const { backend, sessionId } = await setup();
  const session = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  if (!session.workflowId) throw new Error("Expected a started workflow");

  await backend.mutation(internal.tasks.lifecycle.onComplete, {
    workflowId: session.workflowId,
    context: { sessionId },
    result: { kind: "failed", error: "Provider unavailable" },
  });

  const failed = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(failed.state).toEqual({ kind: "failed", error: "Provider unavailable" });
  expect(failed.cleanupJobId).toBeDefined();
});

it("updates a streamed item without duplicating history and remembers tool results", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "running" },
  });
  const item = { providerItemId: "message", kind: "assistant", text: "Opening", details: "{}" };
  await backend.mutation(internal.tasks.sessions.saveItems, { sessionId, items: [item] });
  await backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [{ ...item, text: "Opened the site" }],
    cursor: "message",
  });
  const history = await owner.query(api.tasks.sessions.listItems, {
    sessionId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(history.page).toHaveLength(1);
  expect(history.page[0]?.text).toBe("Opened the site");
  const first = await backend.mutation(internal.tasks.sessions.claimCall, {
    sessionId,
    callId: "send-email",
  });
  expect(first.fresh).toBe(true);
  await backend.mutation(internal.tasks.sessions.finishCall, {
    callId: first.call._id,
    result: { kind: "success", output: "sent" },
  });
  const repeated = await backend.mutation(internal.tasks.sessions.claimCall, {
    sessionId,
    callId: "send-email",
  });
  expect(repeated.fresh).toBe(false);
  expect(repeated.call.result).toEqual({ kind: "success", output: "sent" });
});

it("does not schedule cleanup over an idle session's next send", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    providerId: "provider-session",
    active: false,
    state: { kind: "idle" },
  });
  const before = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.active).toBe(false);
  await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" });
  const sent = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(sent.workflowId).not.toBe(before.workflowId);
  expect(sent.active).toBe(true);
});

it("keeps the Scout reserved while stopping a handoff and schedules cleanup only once", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    providerId: "provider-session",
    state: { kind: "waiting", message: "Captcha", callId: "call", turnId: "turn" },
  });
  const before = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.cleanupJobId).toBeDefined();
  expect(stopped.active).toBe(true);
  await expect(
    owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" }),
  ).rejects.toThrow("Stop the current run");
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  expect(
    (await backend.query(internal.tasks.sessions.cleanupResources, { sessionId })).cleanupJobId,
  ).toBe(stopped.cleanupJobId);
});

it("does not launch a second cleanup while failed-workflow cleanup owns the Scout", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "failed", error: "Provider failed" },
  });
  await backend.mutation(internal.tasks.sessions.scheduleCleanup, { sessionId });
  const before = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.cleanupJobId).toBe(before.cleanupJobId);
  expect(stopped.active).toBe(true);
});

it.each(["active", "closing"] as const)(
  "blocks Agents API start/send while a legacy browser is %s without a pending turn",
  async (kind) => {
    const { backend, owner, scoutId, sessionId } = await setup();
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      providerId: "provider-session",
      active: false,
      state: { kind: "idle" },
    });
    const browserId = await backend.run(async (ctx) =>
      ctx.db.insert("scoutBrowserSessions", {
        scoutId,
        threadId: "manual-browser",
        sequence: 1,
        provider: "firecrawl",
        providerSessionId: "legacy-browser",
        profileName: "profile",
        viewport: { width: 1280, height: 800 },
        nextOperationSequence: 1,
        lifecycle: {
          ...(kind === "closing" ? { kind, closingAtMs: 2 } : { kind }),
          openedAtMs: 1,
          providerExpiresAtMs: 3_600_000,
          cdpUrl: "wss://browser.example.test/cdp",
          interactiveLiveViewUrl: null,
        },
      }),
    );
    expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(false);
    const availability = kind === "closing" ? "stopping" : "browser_open";
    expect(await owner.query(api.scout.scouts.get, { slug: "scout" })).toMatchObject({
      availability,
      currentActivity: { kind: "private" },
    });
    expect(await backend.query(api.scout.activity.players, {})).toMatchObject([
      { availability, busy: true },
    ]);
    await expect(
      owner.mutation(api.tasks.sessions.start, {
        scoutId,
        prompt: "New session",
        engine: "agents_api",
      }),
    ).rejects.toThrow("existing browser");
    await expect(
      owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" }),
    ).rejects.toThrow("existing browser");
    await backend.run(async (ctx) => ctx.db.delete("scoutBrowserSessions", browserId));
    await expect(
      owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" }),
    ).resolves.toBeNull();
  },
);
