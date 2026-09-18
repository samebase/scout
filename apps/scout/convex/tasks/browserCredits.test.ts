/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { requireRuntimeTool } from "../scout/lib/runtimeTool";
import { runtimeTools } from "./tools";

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
  const open = async () =>
    await backend.action(async (ctx) => {
      const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, {
        sessionId,
      });
      const resource = await runtimeTools(
        ctx,
        session,
        scout,
        "create_new_firecrawl_session",
        purpose,
      );
      try {
        return await requireRuntimeTool(resource.tools, "create_new_firecrawl_session").execute(
          { url: "https://example.com" },
          { toolCallId: "open-1", messages: [], context: undefined },
        );
      } finally {
        await resource.dispose();
      }
    });
  return { backend, open, userId };
}

it("charges a created browser with no CDP URL after compensating deletion", async () => {
  const { backend, open, userId } = await setup();
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  const create = vi.spyOn(Firecrawl.prototype, "browser").mockResolvedValue({
    success: true,
    id: "orphan-1",
  });
  const deletion = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
    success: true,
    creditsBilled: 2,
  });
  await expect(open()).rejects.toThrow("CDP URL");
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ ttl: 3_600, activityTtl: 3_600 }));
  expect(deletion).toHaveBeenCalledWith("orphan-1");
  const { browsers, entries, wallet } = await backend.run(async (ctx) => ({
    browsers: await ctx.db.query("agentsApiBrowserSessions").take(1),
    entries: await ctx.db.query("creditEntries").take(3),
    wallet: await ctx.db.query("creditWallets").unique(),
  }));
  expect(browsers).toMatchObject([
    { providerSessionId: "orphan-1", lifecycle: { kind: "closed", creditsBilled: 2 } },
  ]);
  expect(entries.filter((entry) => entry.detail.kind === "usage")).toHaveLength(1);
  expect(wallet?.balanceUnits).toBe(490_000);
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
