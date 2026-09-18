/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const backend = convexTest(schema, modules);
  const { userId, otherUserId, sessionId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const otherUserId = await insertTestAccount(ctx, { email: "member@example.com" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "test", address: "test@example.com" },
      firecrawl: { profileName: "test-profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      state: { kind: "running" },
      active: true,
      nextSequence: 0,
      browser: null,
      usage: null,
    });
    return { userId, otherUserId, sessionId };
  });
  const owner = backend.withIdentity({ subject: userId });
  const other = backend.withIdentity({ subject: otherUserId });
  const open = (providerSessionId: string) =>
    backend.mutation(internal.tasks.browsers.open, {
      sessionId,
      browser: {
        providerSessionId,
        cdpUrl: "wss://browser.example.com/private",
        liveViewUrl: "https://liveview.firecrawl.dev/view",
        interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
        currentUrl: null,
      },
    });
  const list = () => owner.query(api.tasks.sessions.listBrowsers, { sessionId });
  return { backend, owner, other, userId, sessionId, open, list };
}

it("retains ordered browser history and billed usage across close/reopen without exposing connection secrets", async () => {
  const { backend, owner, sessionId, open, list } = await setup();
  await open("browser-1");
  const first = (await list())[0];
  expect(first).toMatchObject({
    sequence: 1,
    lifecycle: { kind: "active" },
    liveViewUrl: "https://liveview.firecrawl.dev/view",
  });
  expect(JSON.stringify(first)).not.toContain("private");
  await expect(open("browser-2")).rejects.toThrow("Close the current browser");
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "browser-1",
    providerDurationMs: 60_000,
    creditsBilled: 2,
  });
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "browser-1",
    providerDurationMs: null,
    creditsBilled: null,
  });
  expect((await owner.query(api.tasks.sessions.get, { sessionId })).browser).toBeNull();
  await open("browser-2");
  const history = await list();
  expect(history.map((browser) => browser.sequence)).toEqual([1, 2]);
  expect(history[0]).toMatchObject({
    _id: first?._id,
    lifecycle: { kind: "closed", providerDurationMs: 60_000, creditsBilled: 2 },
    liveViewUrl: null,
    interactiveLiveViewUrl: null,
  });
});

it("reserves an affordable Firecrawl lifetime and settles its reported usage once", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, owner, userId, sessionId } = await setup();
  const funding = await backend.mutation(internal.tasks.browsers.reserve, { sessionId });
  expect(funding.durationSeconds).toBe(15 * 60);
  expect(await owner.query(api.credits.balance, {})).toMatchObject({
    balanceUnits: 500_000,
    reservedUnits: 150_000,
  });
  await backend.mutation(internal.tasks.browsers.open, {
    sessionId,
    reservationId: funding.reservationId,
    browser: {
      providerSessionId: "funded-browser",
      cdpUrl: "wss://browser.example.test/cdp",
      liveViewUrl: null,
      interactiveLiveViewUrl: null,
      currentUrl: null,
    },
  });
  const close = {
    providerSessionId: "funded-browser",
    providerDurationMs: 60_000,
    creditsBilled: 2,
  };
  await backend.mutation(internal.tasks.browsers.close, close);
  await backend.mutation(internal.tasks.browsers.close, close);
  expect(await owner.query(api.credits.balance, {})).toMatchObject({
    balanceUnits: 490_000,
    reservedUnits: 0,
  });
  const entries = await backend.run(async (ctx) =>
    ctx.db
      .query("creditEntries")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(entries.filter((entry) => entry.detail.kind === "usage")).toHaveLength(1);
});

it("keeps unknown creation billing unresolved and allows a later funded browser", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, owner, sessionId } = await setup();
  const first = await backend.mutation(internal.tasks.browsers.reserve, { sessionId });
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "created-without-cdp",
    reservationId: first.reservationId,
    providerDurationMs: null,
    creditsBilled: null,
  });
  const unresolved = await backend.run((ctx) => ctx.db.get(first.reservationId));
  expect(unresolved?.state).toMatchObject({
    kind: "unresolved",
    reason: expect.stringContaining("created-without-cdp"),
  });
  expect(await owner.query(api.credits.balance, {})).toMatchObject({ reservedUnits: 150_000 });

  const second = await backend.mutation(internal.tasks.browsers.reserve, { sessionId });
  await backend.mutation(internal.tasks.browsers.open, {
    sessionId,
    reservationId: second.reservationId,
    browser: {
      providerSessionId: "browser-after-failure",
      cdpUrl: "wss://browser.example.test/cdp",
      liveViewUrl: null,
      interactiveLiveViewUrl: null,
      currentUrl: null,
    },
  });
  const browsers = await owner.query(api.tasks.sessions.listBrowsers, { sessionId });
  expect(browsers.map((browser) => browser.sequence)).toEqual([2]);
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "browser-after-failure",
    providerDurationMs: null,
    creditsBilled: 1,
  });
  const settled = await backend.run((ctx) => ctx.db.get(second.reservationId));
  expect(settled?.state).toMatchObject({ kind: "settled", costMicrodollars: 5_000 });
});

it("shortens a browser TTL when only a small wallet balance is available", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, userId, sessionId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Missing wallet");
    await ctx.db.patch(wallet._id, { balanceUnits: 20_000 });
  });
  expect(await backend.mutation(internal.tasks.browsers.reserve, { sessionId })).toMatchObject({
    durationSeconds: 60,
  });
});

it("keeps a failed close inspectable and settles it if provider usage later arrives", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, sessionId } = await setup();
  const funding = await backend.mutation(internal.tasks.browsers.reserve, { sessionId });
  await backend.mutation(internal.tasks.browsers.open, {
    sessionId,
    reservationId: funding.reservationId,
    browser: {
      providerSessionId: "close-failed",
      cdpUrl: "wss://browser.example.test/cdp",
      liveViewUrl: null,
      interactiveLiveViewUrl: null,
      currentUrl: null,
    },
  });
  await backend.mutation(internal.tasks.browsers.unresolved, {
    providerSessionId: "close-failed",
    reason: "Provider deletion failed",
  });
  expect((await backend.run((ctx) => ctx.db.get(funding.reservationId)))?.state).toMatchObject({
    kind: "unresolved",
    reason: expect.stringContaining("close-failed"),
  });
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "close-failed",
    providerDurationMs: 60_000,
    creditsBilled: 2,
  });
  expect((await backend.run((ctx) => ctx.db.get(funding.reservationId)))?.state).toMatchObject({
    kind: "settled",
    costMicrodollars: 10_000,
  });
});

it("persists real tab telemetry and clicks for the shared replay after the live browser closes", async () => {
  const { backend, owner, open, list } = await setup();
  await open("browser-1");
  const operation = {
    providerSessionId: "browser-1",
    toolCallId: "navigate",
    action: { kind: "open" as const, url: "https://example.com" },
  };
  expect(await backend.mutation(internal.tasks.browsers.prepareOperation, operation)).toBe(true);
  expect(await backend.mutation(internal.tasks.browsers.prepareOperation, operation)).toBe(false);
  const telemetry = {
    version: 1 as const,
    dispatchedAtMs: 100,
    returnedAtMs: 200,
    before: {
      capturedAtMs: 100,
      tabs: [{ tabId: "tab-1", title: "Example", url: "https://example.com", active: true }],
    },
    after: {
      capturedAtMs: 200,
      tabs: [
        { tabId: "tab-1", title: "Example", url: "https://example.com", active: false },
        { tabId: "tab-2", title: "About", url: "https://example.com/about", active: true },
      ],
    },
  };
  const clickCapture = {
    kind: "captured" as const,
    startedAtMs: 100,
    endedAtMs: 200,
    incomplete: false,
    truncated: false,
    clicks: [{ tabId: "tab-1", atMs: 150, x: 0.5, y: 0.25 }],
  };
  await backend.mutation(internal.tasks.browsers.settleOperation, {
    providerSessionId: "browser-1",
    toolCallId: "navigate",
    outcome: { kind: "applied", telemetry },
    clickCapture,
  });
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "browser-1",
    providerDurationMs: 100,
    creditsBilled: 1,
  });
  const [browser] = await list();
  if (!browser) throw new Error("Missing browser");
  const replay = await owner.query(internal.browserReplay.data, { sessionId: browser._id });
  expect(replay?.operations).toEqual([
    {
      sequence: 1,
      state: { kind: "applied", settledAtMs: expect.any(Number), telemetry },
      clickCapture,
    },
  ]);
  expect(replay?.providerSessionId).toBe("browser-1");
});

it("authorizes both replay endpoints before fetching a provider recording", async () => {
  const { backend, owner, other, sessionId, open, list } = await setup();
  await open("browser-1");
  const [browser] = await list();
  if (!browser) throw new Error("Missing browser");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      success: true,
      pages: [{ pageId: "1", pageUrl: "https://example.com", startTimeMs: 100, endTimeMs: 200 }],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  for (const unauthorized of [backend, other]) {
    expect(
      await unauthorized.action(api.browserReplay.listPages, { sessionId: browser._id }),
    ).toEqual({ status: "unavailable" });
    expect(
      await unauthorized.action(api.browserReplay.loadPlaylist, {
        sessionId: browser._id,
        pageId: "1",
      }),
    ).toEqual({ status: "unavailable" });
  }
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(other.query(api.tasks.sessions.listBrowsers, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  const adminId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "nicu@samebase.com" }),
  );
  const admin = backend.withIdentity({ subject: adminId });
  expect(await admin.action(api.browserReplay.listPages, { sessionId: browser._id })).toMatchObject(
    { status: "ready", pages: [{ pageId: "1" }] },
  );
  fetchMock.mockResolvedValueOnce(new Response("#EXTM3U\n#EXT-X-ENDLIST"));
  expect(
    await admin.action(api.browserReplay.loadPlaylist, { sessionId: browser._id, pageId: "1" }),
  ).toEqual({ status: "ready", playlist: "#EXTM3U\n#EXT-X-ENDLIST" });
  expect(await owner.action(api.browserReplay.listPages, { sessionId: browser._id })).toMatchObject(
    { status: "ready", pages: [{ pageId: "1" }] },
  );
  fetchMock.mockResolvedValueOnce(new Response("#EXTM3U\n#EXT-X-ENDLIST"));
  expect(
    await owner.action(api.browserReplay.loadPlaylist, { sessionId: browser._id, pageId: "1" }),
  ).toEqual({ status: "ready", playlist: "#EXTM3U\n#EXT-X-ENDLIST" });
});
