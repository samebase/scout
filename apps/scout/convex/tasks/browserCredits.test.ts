/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { chromium } from "playwright-core";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { requireRuntimeTool } from "../scout/lib/runtimeTool";
import { runtimeTools } from "./tools";
import { taskBrowserBilling } from "./browserCredits";

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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup() {
  vi.stubEnv("CREDITS_ENABLED", "true");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  const backend = convexTest(schema, modules);
  const { sessionId, userId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
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
      title: "Browser setup",
      model: "gpt-5.6-luna",
      state: { kind: "running" },
      active: true,
      nextSequence: 0,
      browser: null,
      usage: null,
    });
    return { sessionId, userId };
  });
  const execute = async (name: string, input: unknown) =>
    await backend.action(async (ctx) => {
      const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, {
        sessionId,
      });
      const resource = await runtimeTools(ctx, session, scout, name, purpose);
      try {
        return await requireRuntimeTool(resource.tools, name).execute(input, {
          toolCallId: name,
          messages: [],
          context: undefined,
        });
      } finally {
        await resource.dispose();
      }
    });
  const open = () => execute("create_new_firecrawl_session", { url: "https://example.com" });
  return { backend, open, execute, sessionId, userId };
}

async function setupBrokenBrowser() {
  const t = await setup();
  await t.backend.mutation(internal.credits.grantOnSignIn, { userId: t.userId });
  await t.backend.mutation(internal.tasks.browsers.open, {
    sessionId: t.sessionId,
    billable: true,
    browser: {
      providerSessionId: "broken-browser",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=broken",
      liveViewUrl: null,
      interactiveLiveViewUrl: null,
      currentUrl: null,
    },
  });
  const connect = vi.spyOn(chromium, "connectOverCDP").mockRejectedValue(new Error("CDP timeout"));
  const recovery = vi
    .spyOn(Firecrawl.prototype, "listBrowsers")
    .mockRejectedValue(new Error("Browser recovery unavailable"));
  const create = vi
    .spyOn(Firecrawl.prototype, "browser")
    .mockResolvedValue({ success: false, error: "New browser unavailable" });
  return { ...t, connect, recovery, create };
}

it("explicitly closes a broken browser without CDP, bills once, and permits replacement only afterward", async () => {
  const t = await setupBrokenBrowser();
  const deletion = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
    success: true,
    sessionDurationMs: 10_000,
    creditsBilled: 2,
  });
  await expect(t.open()).rejects.toThrow("Close the current browser before opening another");
  expect(t.create).not.toHaveBeenCalled();
  expect(deletion).not.toHaveBeenCalled();

  await expect(t.execute("browser_close", {})).resolves.toEqual({
    success: true,
    sessionDurationMs: 10_000,
    creditsBilled: 2,
  });
  expect(deletion).toHaveBeenCalledExactlyOnceWith("broken-browser");
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.browser).toBeNull();
  const browser = await t.backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").unique());
  expect(browser?.lifecycle).toMatchObject({
    kind: "closed",
    providerDurationMs: 10_000,
    creditsBilled: 2,
  });
  await expect(t.execute("browser_close", {})).resolves.toEqual({
    success: true,
    alreadyClosed: true,
  });
  expect(deletion).toHaveBeenCalledOnce();
  const wallet = await t.backend.run((ctx) => ctx.db.query("creditWallets").unique());
  expect(wallet?.balanceUnits).toBe(490_000);

  await expect(t.open()).rejects.toThrow("New browser unavailable");
  expect(t.create).toHaveBeenCalledOnce();
  expect(t.connect).not.toHaveBeenCalled();
  expect(t.recovery).not.toHaveBeenCalled();
});

it.each(["throw", "rejection"])(
  "retains the browser handle and blocks replacement after deletion %s",
  async (failure) => {
    const t = await setupBrokenBrowser();
    const deletion = vi.spyOn(Firecrawl.prototype, "deleteBrowser");
    if (failure === "throw") deletion.mockRejectedValue(new Error("Deletion failed"));
    else deletion.mockResolvedValue({ success: false, error: "Deletion failed" });

    await expect(t.execute("browser_close", {})).rejects.toThrow("Deletion failed");
    expect(deletion).toHaveBeenCalledExactlyOnceWith("broken-browser");
    expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.browser).toMatchObject({
      providerSessionId: "broken-browser",
    });
    const browser = await t.backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").unique());
    expect(browser?.lifecycle).toMatchObject({ kind: "active", cleanupError: "Deletion failed" });
    const wallet = await t.backend.run((ctx) => ctx.db.query("creditWallets").unique());
    expect(wallet?.balanceUnits).toBe(500_000);
    await expect(t.open()).rejects.toThrow("Close the current browser before opening another");
    expect(t.create).not.toHaveBeenCalled();
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.recovery).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  "retains the billing choice (%s) when a browser without a CDP URL is deleted",
  async (billable) => {
    const { backend, open, userId } = await setup();
    vi.stubEnv("FIRECRAWL_CREDITS_ENABLED", String(billable));
    await backend.mutation(internal.credits.grantOnSignIn, { userId });
    const create = vi.spyOn(Firecrawl.prototype, "browser").mockImplementation(async () => {
      vi.stubEnv("FIRECRAWL_CREDITS_ENABLED", String(!billable));
      return { success: true, id: "orphan-1" };
    });
    const deletion = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
      success: true,
      creditsBilled: 2,
    });
    await expect(open()).rejects.toThrow("CDP URL");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ttl: 3_600, activityTtl: 3_600 }),
    );
    expect(deletion).toHaveBeenCalledWith("orphan-1");
    const { browsers, entries, wallet } = await backend.run(async (ctx) => ({
      browsers: await ctx.db.query("agentsApiBrowserSessions").take(1),
      entries: await ctx.db.query("creditEntries").take(3),
      wallet: await ctx.db.query("creditWallets").unique(),
    }));
    expect(browsers).toMatchObject([
      { providerSessionId: "orphan-1", lifecycle: { kind: "closed", creditsBilled: 2 } },
    ]);
    expect(entries.filter((entry) => entry.detail.kind === "usage")).toHaveLength(billable ? 1 : 0);
    expect(wallet?.balanceUnits).toBe(billable ? 490_000 : 500_000);
  },
);

it.each([true, false])(
  "registers a browser with its original billing choice (%s) after the setting changes",
  async (billable) => {
    const { backend, sessionId } = await setup();
    vi.stubEnv("FIRECRAWL_CREDITS_ENABLED", String(billable));
    vi.spyOn(Firecrawl.prototype, "browser").mockImplementation(async () => {
      vi.stubEnv("FIRECRAWL_CREDITS_ENABLED", String(!billable));
      return { success: true, id: "browser-1" };
    });
    vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
      success: true,
      creditsBilled: 2,
    });
    await backend.action(async (ctx) => {
      const billing = taskBrowserBilling(ctx, sessionId);
      await billing.dependencies.browser({ ttl: 60 });
      await billing.opened({
        providerSessionId: "browser-1",
        cdpUrl: "wss://browser.example.com/private",
        liveViewUrl: null,
        interactiveLiveViewUrl: null,
        currentUrl: null,
      });
      await billing.dependencies.deleteBrowser("browser-1");
    });
    const result = await backend.run(async (ctx) => ({
      browser: await ctx.db.query("agentsApiBrowserSessions").unique(),
      wallet: await ctx.db.query("creditWallets").unique(),
    }));
    expect(result.browser).toMatchObject({
      billable,
      lifecycle: { kind: "closed", creditsBilled: 2 },
    });
    expect(result.wallet?.balanceUnits).toBe(billable ? 490_000 : 500_000);
  },
);

it("rejects an invalid Firecrawl billing setting before calling the provider", async () => {
  const { open } = await setup();
  vi.stubEnv("FIRECRAWL_CREDITS_ENABLED", "tru");
  const create = vi.spyOn(Firecrawl.prototype, "browser");
  await expect(open()).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

it("keeps a failed compensating deletion visible without freezing credits", async () => {
  const { backend, open, userId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  vi.spyOn(Firecrawl.prototype, "browser").mockResolvedValue({ success: true, id: "orphan-2" });
  vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockRejectedValue(new Error("cleanup failed"));
  await expect(open()).rejects.toThrow("cleanup failed");
  const browsers = await backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").take(2));
  expect(browsers).toMatchObject([
    {
      providerSessionId: "orphan-2",
      lifecycle: { kind: "active", cleanupError: expect.stringContaining("cleanup failed") },
    },
  ]);
  const wallet = await backend.run((ctx) => ctx.db.query("creditWallets").unique());
  expect(wallet?.balanceUnits).toBe(500_000);
});

it("does not charge a provider rejection without a browser ID", async () => {
  const { backend, open, userId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  vi.spyOn(Firecrawl.prototype, "browser").mockResolvedValue({
    success: false,
    error: "Browser creation rejected",
  });
  const deletion = vi.spyOn(Firecrawl.prototype, "deleteBrowser");
  await expect(open()).rejects.toThrow("Browser creation rejected");
  expect(deletion).not.toHaveBeenCalled();
  expect(await backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").take(1))).toEqual([]);
  expect(await backend.run((ctx) => ctx.db.query("creditUsageTotals").take(1))).toEqual([]);
});

it("rejects a nonpositive wallet before calling Firecrawl", async () => {
  const { backend, open, userId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await backend.run(async (ctx) => {
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Missing wallet");
    await ctx.db.patch(wallet._id, { balanceUnits: 0 });
  });
  const create = vi.spyOn(Firecrawl.prototype, "browser");
  await expect(open()).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
