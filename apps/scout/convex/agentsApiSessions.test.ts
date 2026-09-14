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
afterEach(() => vi.useRealTimers());

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
  const sessionId = await owner.mutation(api.agentsApi.sessions.start, {
    scoutId: ids.scoutId,
    prompt: "Explore example.com",
  });
  return { backend, owner, ...ids, sessionId };
}

it("allows admin inspection and holds the Scout for both runtimes", async () => {
  const { backend, owner, scoutId, sessionId } = await setup();
  await expect(backend.query(api.agentsApi.sessions.get, { sessionId })).rejects.toThrow();
  const otherId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "nicu@samebase.com" }),
  );
  expect(
    await backend
      .withIdentity({ subject: otherId })
      .query(api.agentsApi.sessions.get, { sessionId }),
  ).toMatchObject({ _id: sessionId, canControl: false });
  await expect(
    owner.mutation(api.agentsApi.sessions.start, { scoutId, prompt: "Another run" }),
  ).rejects.toThrow("already working");
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
  await backend.mutation(internal.agentsApi.sessions.update, { sessionId, active: false });
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(false);
});

it("lists and inspects a member's private Review without granting session control", async () => {
  const { backend, owner: admin, scoutId, sessionId: previousSessionId } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId: previousSessionId,
    state: { kind: "stopped" },
    active: false,
  });
  const memberId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "reviewer@example.com" }),
  );
  const member = backend.withIdentity({ subject: memberId });
  const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
    kind: "review",
    scoutId,
    prompt: "Try example.com",
    visibility: "private",
  });
  const firstPage = await admin.query(api.agentsApi.sessions.list, {
    paginationOpts: { numItems: 1, cursor: null },
  });
  const sessionId = firstPage.page[0]?._id;
  if (!sessionId) throw new Error("Missing Review session");
  expect(sessionId).toBe(threadId);
  expect(firstPage.isDone).toBe(false);
  const nextPage = await admin.query(api.agentsApi.sessions.list, {
    paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
  });
  expect(nextPage.page.map((session) => session._id)).toEqual([previousSessionId]);
  await backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    items: [
      { providerItemId: "reply", kind: "assistant", text: "I opened the site.", details: "{}" },
    ],
  });
  await backend.mutation(internal.agentsApi.browsers.open, {
    sessionId,
    browser: {
      providerSessionId: "browser-1",
      cdpUrl: "wss://private.example.com",
      liveViewUrl: "https://example.com/view",
      interactiveLiveViewUrl: "https://example.com/control",
      currentUrl: null,
    },
  });
  expect(await admin.query(api.agentsApi.sessions.get, { sessionId })).toMatchObject({
    canControl: false,
    browser: { liveViewUrl: "https://example.com/view", interactiveLiveViewUrl: null },
  });
  const items = await admin.query(api.agentsApi.sessions.listItems, {
    sessionId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(items.page[0]?.text).toBe("I opened the site.");
  const browsers = await admin.query(api.agentsApi.sessions.listBrowsers, { sessionId });
  expect(browsers[0]).toMatchObject({
    liveViewUrl: "https://example.com/view",
    interactiveLiveViewUrl: null,
  });
  expect(JSON.stringify(browsers)).not.toContain("private.example.com");

  for (const viewer of [backend, member]) {
    await expect(
      viewer.query(api.agentsApi.sessions.list, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Not authorized");
    await expect(viewer.query(api.agentsApi.sessions.get, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      viewer.query(api.agentsApi.sessions.listItems, {
        sessionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Not authorized");
    await expect(viewer.query(api.agentsApi.sessions.listBrowsers, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
  }
  await expect(
    admin.mutation(api.agentsApi.sessions.send, { sessionId, message: "Continue" }),
  ).rejects.toThrow("Session not found");
  await expect(admin.mutation(api.agentsApi.sessions.resume, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(admin.mutation(api.agentsApi.sessions.stop, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(member.mutation(api.agentsApi.sessions.stop, { sessionId })).resolves.toBeNull();
});

it("does not revive a stopped session or dispatch tools after stopping", async () => {
  const { backend, owner, sessionId } = await setup();
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    state: { kind: "running" },
  });
  expect((await owner.query(api.agentsApi.sessions.get, { sessionId })).state.kind).toBe("stopped");
  await expect(
    backend.mutation(internal.agentsApi.sessions.claimCall, { sessionId, callId: "call" }),
  ).rejects.toThrow("stopped");
});

it("keeps an explicit stop when an in-flight workflow fails and still schedules cleanup", async () => {
  const { backend, owner, sessionId, scoutId } = await setup();
  const session = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  if (!session.workflowId) throw new Error("Expected a started workflow");
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  await expect(
    backend.mutation(internal.agentsApi.sessions.claimCall, { sessionId, callId: "late-call" }),
  ).rejects.toThrow("Session stopped before tool dispatch");

  await backend.mutation(internal.agentsApi.lifecycle.onComplete, {
    workflowId: session.workflowId,
    context: { sessionId },
    result: { kind: "failed", error: "Session stopped before tool dispatch" },
  });

  const stopped = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(stopped.state).toEqual({ kind: "stopped" });
  expect(stopped.cleanupJobId).toBeDefined();
  expect(await backend.run((ctx) => scoutIsWorking(ctx, scoutId))).toBe(true);
});

it("reports workflow errors when the owner has not stopped the session", async () => {
  const { backend, sessionId } = await setup();
  const session = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  if (!session.workflowId) throw new Error("Expected a started workflow");

  await backend.mutation(internal.agentsApi.lifecycle.onComplete, {
    workflowId: session.workflowId,
    context: { sessionId },
    result: { kind: "failed", error: "Provider unavailable" },
  });

  const failed = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(failed.state).toEqual({ kind: "failed", error: "Provider unavailable" });
  expect(failed.cleanupJobId).toBeDefined();
});

it("updates a streamed item without duplicating history and remembers tool results", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    state: { kind: "running" },
  });
  const item = { providerItemId: "message", kind: "assistant", text: "Opening", details: "{}" };
  await backend.mutation(internal.agentsApi.sessions.saveItems, { sessionId, items: [item] });
  await backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    items: [{ ...item, text: "Opened the site" }],
    cursor: "message",
  });
  const history = await owner.query(api.agentsApi.sessions.listItems, {
    sessionId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(history.page).toHaveLength(1);
  expect(history.page[0]?.text).toBe("Opened the site");
  const first = await backend.mutation(internal.agentsApi.sessions.claimCall, {
    sessionId,
    callId: "send-email",
  });
  expect(first.fresh).toBe(true);
  await backend.mutation(internal.agentsApi.sessions.finishCall, {
    callId: first.call._id,
    result: { kind: "success", output: "sent" },
  });
  const repeated = await backend.mutation(internal.agentsApi.sessions.claimCall, {
    sessionId,
    callId: "send-email",
  });
  expect(repeated.fresh).toBe(false);
  expect(repeated.call.result).toEqual({ kind: "success", output: "sent" });
});

it("does not schedule cleanup over an idle session's next send", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    providerId: "provider-session",
    active: false,
    state: { kind: "idle" },
  });
  const before = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.active).toBe(false);
  await owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" });
  const sent = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(sent.workflowId).not.toBe(before.workflowId);
  expect(sent.active).toBe(true);
});

it("keeps the Scout reserved while stopping a handoff and schedules cleanup only once", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    providerId: "provider-session",
    state: { kind: "waiting", message: "Captcha", callId: "call", turnId: "turn" },
  });
  const before = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.cleanupJobId).toBeDefined();
  expect(stopped.active).toBe(true);
  await expect(
    owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" }),
  ).rejects.toThrow("Stop the current run");
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  expect(
    (await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId })).cleanupJobId,
  ).toBe(stopped.cleanupJobId);
});

it("does not launch a second cleanup while failed-workflow cleanup owns the Scout", async () => {
  const { backend, owner, sessionId } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    state: { kind: "failed", error: "Provider failed" },
  });
  await backend.mutation(internal.agentsApi.sessions.scheduleCleanup, { sessionId });
  const before = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  const stopped = await backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  expect(stopped.workflowId).toBe(before.workflowId);
  expect(stopped.cleanupJobId).toBe(before.cleanupJobId);
  expect(stopped.active).toBe(true);
});

it.each(["active", "closing"] as const)(
  "blocks Agents API start/send while a legacy browser is %s without a pending turn",
  async (kind) => {
    const { backend, owner, scoutId, sessionId } = await setup();
    await backend.mutation(internal.agentsApi.sessions.update, {
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
      owner.mutation(api.agentsApi.sessions.start, { scoutId, prompt: "New session" }),
    ).rejects.toThrow("existing browser");
    await expect(
      owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" }),
    ).rejects.toThrow("existing browser");
    await backend.run(async (ctx) => ctx.db.delete("scoutBrowserSessions", browserId));
    await expect(
      owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" }),
    ).resolves.toBeNull();
  },
);
