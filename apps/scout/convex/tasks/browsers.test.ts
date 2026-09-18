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

it("charges reported browser usage once, allows an overrun, and blocks the next open", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, owner, userId, sessionId, open } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Missing wallet");
    await ctx.db.patch(wallet._id, { balanceUnits: 1_000 });
  });
  expect(await backend.mutation(internal.tasks.browsers.admit, { sessionId })).toBe(true);
  await open("billable-browser");
  const close = {
    providerSessionId: "billable-browser",
    providerDurationMs: 60_000,
    creditsBilled: 2,
  };
  await backend.mutation(internal.tasks.browsers.close, close);
  await backend.mutation(internal.tasks.browsers.close, close);
  expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: -9_000 });
  const { entries, totals } = await backend.run(async (ctx) => ({
    entries: await ctx.db.query("creditEntries").collect(),
    totals: await ctx.db.query("creditUsageTotals").collect(),
  }));
  expect(entries.filter((entry) => entry.detail.kind === "usage")).toHaveLength(1);
  expect(totals).toMatchObject([{ kind: "browser", totalCostMicrodollars: 10_000 }]);
  await expect(backend.mutation(internal.tasks.browsers.admit, { sessionId })).rejects.toThrow();
});

it("keeps missing browser usage visible and charges a later report without blocking another open", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, owner, userId, sessionId, open, list } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  expect(await backend.mutation(internal.tasks.browsers.admit, { sessionId })).toBe(true);
  await open("missing-report");
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "missing-report",
    providerDurationMs: null,
    creditsBilled: null,
  });
  expect((await list())[0]?.lifecycle).toMatchObject({ kind: "closed", creditsBilled: null });
  expect(await backend.mutation(internal.tasks.browsers.admit, { sessionId })).toBe(true);
  await backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "missing-report",
    providerDurationMs: 60_000,
    creditsBilled: 1,
  });
  expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 495_000 });
  expect((await list())[0]?.lifecycle).toMatchObject({ creditsBilled: 1 });
});

it("records orphan browser cleanup and charges its reported usage once", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, owner, userId, sessionId, list } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  const close = {
    providerSessionId: "orphan-browser",
    providerDurationMs: 30_000,
    creditsBilled: 2,
    orphan: { sessionId, billable: true, openedAtMs: 1_000 },
  };
  await backend.mutation(internal.tasks.browsers.close, close);
  await backend.mutation(internal.tasks.browsers.close, close);
  expect((await list())[0]?.lifecycle).toMatchObject({ kind: "closed", creditsBilled: 2 });
  expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 490_000 });
  const entries = await backend.run((ctx) => ctx.db.query("creditEntries").collect());
  expect(entries.filter((entry) => entry.detail.kind === "usage")).toHaveLength(1);
});

it("blocks a new browser operation when another charge exhausts the wallet", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const { backend, userId, open } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await open("active-browser");
  await backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Missing wallet");
    await ctx.db.patch(wallet._id, { balanceUnits: 0 });
  });
  await expect(
    backend.mutation(internal.tasks.browsers.prepareOperation, {
      providerSessionId: "active-browser",
      toolCallId: "new-step",
      action: { kind: "open", url: "https://example.com" },
    }),
  ).rejects.toThrow();
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
