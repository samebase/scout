/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import { syncChatSite } from "./scout/siteListings";
import { omitNullish } from "../shared/omitNullish";
import { ACCOUNT_DELETION_CONFIRMATION } from "../shared/accountDeletion";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  agentTest.register(backend);
  workflowTest.register(backend);
  const { userId, otherId, adminId, scoutId } = await backend.run(async (ctx) => ({
    userId: await insertTestAccount(ctx, { email: "owner@example.test" }),
    otherId: await insertTestAccount(ctx, { email: "other@example.test" }),
    adminId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Site Scout",
      slug: "site-scout",
      status: "active",
      websiteIdentity: { firstName: "Site", lastName: "Scout" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    }),
  }));
  const owner = backend.withIdentity({ subject: userId });
  const other = backend.withIdentity({ subject: otherId });
  const admin = backend.withIdentity({ subject: adminId });
  async function decide(checkId: Id<"agentsApiRequestChecks">, approved: boolean) {
    await backend.mutation(internal.tasks.requestChecks.start, {
      checkId,
      startedAt: 1,
      request: "{}",
      evidence: null,
    });
    return backend.mutation(internal.tasks.requestChecks.finish, {
      checkId,
      state: {
        kind: "completed",
        finishedAt: 2,
        call: { startedAt: 1, request: "{}", response: "{}", usage: null },
        result: {
          kind: "initial",
          title: "Review",
          decision: approved ? { kind: "approved" } : { kind: "rejected", reason: "Rejected" },
        },
      },
    });
  }
  async function review(
    site: string | null,
    createdAt: number,
    overrides: Partial<{
      userId: Id<"users">;
      visibility: Doc<"scoutChats">["visibility"];
      decision: "pending" | "approved" | "rejected";
      legacy: boolean;
    }> = {},
  ) {
    const options = {
      userId,
      visibility: "public",
      decision: "approved",
      legacy: false,
      ...overrides,
    } satisfies {
      userId: Id<"users">;
      visibility: Doc<"scoutChats">["visibility"];
      decision: string;
      legacy: boolean;
    };
    const ids = await backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("agentsApiSessions", {
        userId: options.userId,
        scoutId,
        scoutName: "Site Scout",
        title: "Review",
        model: "gpt-5.6-luna",
        state: { kind: "starting" },
        active: true,
        nextSequence: 0,
        browser: null,
        usage: null,
      });
      const chatId = await ctx.db.insert("scoutChats", {
        userId: options.userId,
        scoutId,
        threadId: sessionId,
        createdAt,
        purpose: { kind: "review" },
        visibility: options.visibility,
        runtime: { kind: "agents_api", sessionId },
        ...omitNullish({
          primarySite: site,
          publicSiteEligible: options.legacy ? undefined : false,
        }),
      });
      const checkId = await ctx.db.insert("agentsApiRequestChecks", {
        sessionId,
        kind: "initial",
        model: "gpt-5.6-luna",
        prompt: "Review this site",
        state: { kind: "pending" },
      });
      return { sessionId, chatId, checkId };
    });
    if (!options.legacy) {
      if (site !== null)
        await backend
          .withIdentity({ subject: options.userId })
          .mutation(api.scout.reviewSites.set, { threadId: ids.sessionId, site });
      if (options.decision !== "pending")
        await decide(ids.checkId, options.decision === "approved");
    } else if (options.decision !== "pending") {
      await backend.run((ctx) =>
        ctx.db.patch(ids.checkId, {
          state: {
            kind: "completed",
            finishedAt: 2,
            call: { startedAt: 1, request: "{}", response: "{}", usage: null },
            result: {
              kind: "initial",
              title: "Review",
              decision:
                options.decision === "approved"
                  ? { kind: "approved" }
                  : { kind: "rejected", reason: "Rejected" },
            },
          },
        }),
      );
    }
    return ids;
  }
  const list = (
    scope: "public" | "mine",
    cursor: string | null = null,
    numItems = 24,
    site: string | null = null,
  ) => owner.query(api.scout.sites.list, { scope, site, paginationOpts: { cursor, numItems } });
  const tasks = (
    scope: "public" | "mine",
    site: string | null,
    cursor: string | null = null,
    numItems = 24,
  ) => owner.query(api.scout.activity.list, { scope, site, paginationOpts: { cursor, numItems } });
  const visibility = (threadId: string, visibility: "public" | "private") =>
    owner.mutation(api.scout.chats.setVisibility, { threadId, visibility });
  const remove = (chatId: Id<"scoutChats">) =>
    backend.run(async (ctx) => {
      const before = await ctx.db.get(chatId);
      if (!before) throw new Error("Missing chat");
      await ctx.db.delete(chatId);
      await syncChatSite(ctx, before);
    });
  return {
    backend,
    owner,
    other,
    admin,
    userId,
    otherId,
    scoutId,
    review,
    decide,
    list,
    tasks,
    visibility,
    remove,
  };
}

test("approval, identification, edits, and visibility update public and owner directories atomically", async () => {
  const t = await setup();
  const pending = await t.review(null, 10, { decision: "pending" });
  await t.backend.mutation(internal.scout.reviewSites.identify, {
    sessionId: pending.sessionId,
    site: " EXAMPLE.TEST ",
  });
  expect((await t.list("public")).page).toEqual([]);
  expect((await t.list("mine")).page).toEqual([
    { hostname: "example.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  expect(await t.other.query(api.scout.sites.get, { site: "example.test" })).toBeNull();
  expect(await t.owner.query(api.scout.sites.get, { site: "EXAMPLE.TEST" })).toEqual({
    hostname: "example.test",
    preview: null,
    profile: null,
    research: null,
  });
  await t.decide(pending.checkId, true);
  expect((await t.list("public")).page).toEqual([
    { hostname: "example.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  expect((await t.tasks("public", "example.test")).page.map((row) => row.threadId)).toEqual([
    pending.sessionId,
  ]);
  await t.backend.mutation(internal.scout.reviewSites.identify, {
    sessionId: pending.sessionId,
    site: "ignored.test",
  });
  expect(await t.admin.query(api.scout.sites.get, { site: "ignored.test" })).toBeNull();
  await t.owner.mutation(api.scout.reviewSites.set, {
    threadId: pending.sessionId,
    site: " MOVED.TEST ",
  });
  expect((await t.list("public")).page).toEqual([
    { hostname: "moved.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  expect((await t.list("mine")).page).toEqual([
    { hostname: "moved.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  expect(await t.owner.query(api.scout.sites.get, { site: "example.test" })).toBeNull();
  await t.visibility(pending.sessionId, "private");
  expect((await t.list("public")).page).toEqual([]);
  expect((await t.tasks("public", "moved.test")).page).toEqual([]);
  expect((await t.list("mine")).page).toEqual([
    { hostname: "moved.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  await t.visibility(pending.sessionId, "public");
  expect((await t.list("public")).page).toEqual([
    { hostname: "moved.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  await expect(
    t.other.mutation(api.scout.reviewSites.set, {
      threadId: pending.sessionId,
      site: "stolen.test",
    }),
  ).rejects.toThrow();
  await expect(
    t.owner.mutation(api.scout.reviewSites.set, {
      threadId: pending.sessionId,
      site: "https://invalid.test/path",
    }),
  ).rejects.toThrow();
  expect((await t.list("public")).page).toEqual([
    { hostname: "moved.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
});

test("site cursors count sites, order by latest eligible activity, and never expose other owners' private sites", async () => {
  const t = await setup();
  await t.review("old.test", 1);
  await t.review("second.test", 2);
  const latest = await t.review("old.test", 3);
  await t.review("private.test", 100, { visibility: "private" });
  await t.review("pending.test", 200, { decision: "pending" });
  await t.review("rejected.test", 300, { decision: "rejected" });
  await t.review("other-private.test", 400, { userId: t.otherId, visibility: "private" });
  await t.review("other-public.test", 4, { userId: t.otherId });
  for (let i = 0; i < 105; i++) await t.review("second.test", 1000 + i, { decision: "pending" });
  const first = await t.list("public", null, 1);
  const second = await t.list("public", first.continueCursor, 1);
  const third = await t.list("public", second.continueCursor, 1);
  expect([...first.page, ...second.page, ...third.page]).toEqual([
    { hostname: "other-public.test", taskCount: 1, preview: null, profile: null, research: null },
    { hostname: "old.test", taskCount: 2, preview: null, profile: null, research: null },
    { hostname: "second.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  expect(third.isDone).toBe(true);
  expect((await t.list("mine")).page.map((row) => row.hostname)).toEqual([
    "second.test",
    "rejected.test",
    "pending.test",
    "private.test",
    "old.test",
  ]);
  expect(await t.owner.query(api.scout.sites.get, { site: "other-private.test" })).toBeNull();
  expect((await t.list("public", null, 2, " PRIVATE.TEST ")).page).toEqual([]);
  expect((await t.list("mine", null, 24, " PRIVATE.TEST ")).page).toEqual([
    { hostname: "private.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
  await t.visibility(latest.sessionId, "private");
  expect((await t.list("public")).page.map((row) => row.hostname)).toEqual([
    "other-public.test",
    "second.test",
    "old.test",
  ]);
  await t.visibility(latest.sessionId, "public");
  await t.remove(latest.chatId);
  expect((await t.list("public")).page.map((row) => row.hostname)).toEqual([
    "other-public.test",
    "second.test",
    "old.test",
  ]);
  expect((await t.tasks("public", "second.test", null, 1)).page).toHaveLength(1);
  expect((await t.tasks("public", "second.test", null, 1)).isDone).toBe(true);
});

test("anonymous search pagination metadata is identical for hidden and absent hostnames", async () => {
  const t = await setup();
  await t.review("private.test", 1, { visibility: "private" });
  await t.review("pending.test", 2, { decision: "pending" });
  await t.review("rejected.test", 3, { decision: "rejected" });
  await t.review("public.test", 4);
  await t.backend.mutation(internal.scout.workspaces.snapshot, {
    userId: t.userId,
    target: { kind: "site", site: "workspace.test" },
  });
  const list = (site: string) =>
    t.backend.query(api.scout.sites.list, {
      scope: "public",
      site,
      paginationOpts: { cursor: null, numItems: 1, maximumRowsRead: 1 },
    });
  const absent = await list("absent.test");
  expect(absent.page).toEqual([]);
  for (const hostname of ["private.test", "pending.test", "rejected.test", "workspace.test"]) {
    expect(await t.admin.query(api.scout.sites.get, { site: hostname })).toEqual({
      hostname,
      preview: null,
      profile: null,
      research: null,
    });
    expect(await list(hostname)).toEqual(absent);
  }
  expect((await list("public.test")).page).toEqual([
    { hostname: "public.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
});

test("per-site task cursors include every eligible task, keep mine separate, and retain unassigned mine tasks", async () => {
  const t = await setup();
  const expected: string[] = [];
  for (let i = 1; i <= 7; i++) expected.unshift((await t.review("site.test", i)).sessionId);
  await t.review("site.test", 9, { userId: t.otherId, visibility: "private" });
  const ownPrivate = await t.review("site.test", 10, { visibility: "private" });
  const unassigned = await t.review(null, 11, { visibility: "private" });
  expect((await t.list("public")).page[0].taskCount).toBe(7);
  expect((await t.list("mine")).page[0].taskCount).toBe(8);
  await t.owner.mutation(api.scout.reviewSites.set, {
    threadId: ownPrivate.sessionId,
    site: "site.test",
  });
  expect((await t.list("mine")).page[0].taskCount).toBe(8);
  const a = await t.tasks("public", "site.test", null, 3);
  const b = await t.tasks("public", "site.test", a.continueCursor, 3);
  const c = await t.tasks("public", "site.test", b.continueCursor, 3);
  expect([...a.page, ...b.page, ...c.page].map((row) => row.threadId)).toEqual(expected);
  expect(c.isDone).toBe(true);
  expect((await t.tasks("mine", "site.test")).page.map((row) => row.threadId)).toEqual([
    ownPrivate.sessionId,
    ...expected,
  ]);
  expect((await t.tasks("mine", null)).page[0]).toMatchObject({
    threadId: unassigned.sessionId,
    primarySite: null,
  });
  expect((await t.list("mine")).page).toEqual([
    { hostname: "site.test", taskCount: 8, preview: null, profile: null, research: null },
  ]);
  await t.visibility(ownPrivate.sessionId, "public");
  expect((await t.list("public")).page[0].taskCount).toBe(8);
  expect((await t.list("mine")).page[0].taskCount).toBe(8);
  await t.owner.mutation(api.scout.reviewSites.set, {
    threadId: ownPrivate.sessionId,
    site: "moved.test",
  });
  expect((await t.list("public", null, 24, "site.test")).page[0].taskCount).toBe(7);
  expect((await t.list("mine", null, 24, "site.test")).page[0].taskCount).toBe(7);
  expect((await t.list("public", null, 24, "moved.test")).page[0].taskCount).toBe(1);
  await t.remove(ownPrivate.chatId);
  expect((await t.list("public", null, 24, "moved.test")).page).toEqual([]);
  await expect(
    t.backend.query(api.scout.sites.list, {
      scope: "mine",
      site: null,
      paginationOpts: { cursor: null, numItems: 1 },
    }),
  ).rejects.toThrow("Not authorized");
});

test("deleting or changing the purpose of the last contributing task removes both listings", async () => {
  const t = await setup();
  const a = await t.review("site.test", 1);
  await t.remove(a.chatId);
  expect((await t.list("public")).page).toEqual([]);
  expect((await t.list("mine")).page).toEqual([]);
  expect(await t.owner.query(api.scout.sites.get, { site: "site.test" })).toBeNull();
  const b = await t.review("site.test", 2);
  await t.backend.run(async (ctx) => {
    const before = await ctx.db.get(b.chatId);
    if (!before) throw new Error("Missing chat");
    await ctx.db.patch(b.chatId, { purpose: { kind: "play", step: null } });
    await syncChatSite(ctx, before);
  });
  expect((await t.list("public")).page).toEqual([]);
  expect((await t.list("mine")).page).toEqual([]);
});

test("a stopped session's completed initial check still synchronizes public admission before finish returns false", async () => {
  const t = await setup();
  const task = await t.review("site.test", 1, { decision: "pending" });
  await t.backend.mutation(internal.tasks.requestChecks.start, {
    checkId: task.checkId,
    request: "{}",
    startedAt: 1,
    evidence: null,
  });
  await t.owner.mutation(api.tasks.sessions.stop, { sessionId: task.sessionId });
  expect(
    await t.backend.mutation(internal.tasks.requestChecks.finish, {
      checkId: task.checkId,
      state: {
        kind: "completed",
        finishedAt: 2,
        call: { startedAt: 1, request: "{}", response: "{}", usage: null },
        result: { kind: "initial", title: "Review", decision: { kind: "approved" } },
      },
    }),
  ).toBe(false);
  expect((await t.list("public")).page).toEqual([
    { hostname: "site.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
});

test("workspace creation registers an admin-accessible site without making a public or owner task listing", async () => {
  const t = await setup();
  const args = {
    target: { kind: "site", site: " WORKSPACE.TEST " },
    userId: t.userId,
  } satisfies FunctionArgs<typeof internal.scout.workspaces.snapshot>;
  const first = await t.backend.mutation(internal.scout.workspaces.snapshot, args);
  const second = await t.backend.mutation(internal.scout.workspaces.snapshot, args);
  expect(second.workspaceId).toBe(first.workspaceId);
  expect(await t.admin.query(api.scout.sites.get, { site: "workspace.test" })).toEqual({
    hostname: "workspace.test",
    preview: null,
    profile: null,
    research: null,
  });
  expect(await t.owner.query(api.scout.sites.get, { site: "workspace.test" })).toBeNull();
  expect(await t.backend.query(api.scout.sites.get, { site: "workspace.test" })).toBeNull();
  expect((await t.list("public")).page).toEqual([]);
  expect((await t.list("mine")).page).toEqual([]);
});

test("admin all-sites cursors include workspace-only and private sites in hostname order", async () => {
  const t = await setup();
  await t.review("b.test", 1, { visibility: "private" });
  await t.review("a.test", 10);
  await t.backend.mutation(internal.scout.workspaces.snapshot, {
    userId: t.userId,
    target: { kind: "site", site: "c.test" },
  });
  const args = {
    scope: "all",
    site: null,
    paginationOpts: { cursor: null, numItems: 2 },
  } satisfies FunctionArgs<typeof api.scout.sites.list>;
  const first = await t.admin.query(api.scout.sites.list, args);
  const second = await t.admin.query(api.scout.sites.list, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 2 },
  });
  expect([...first.page, ...second.page]).toEqual([
    { hostname: "a.test", taskCount: 1, preview: null, profile: null, research: null },
    { hostname: "b.test", taskCount: 1, preview: null, profile: null, research: null },
    { hostname: "c.test", taskCount: 0, preview: null, profile: null, research: null },
  ]);
  expect(second.isDone).toBe(true);
  await expect(t.owner.query(api.scout.sites.list, args)).rejects.toThrow("Not authorized");
  await expect(t.backend.query(api.scout.sites.list, args)).rejects.toThrow("Not authorized");
  const search = await t.admin.query(api.scout.sites.list, { ...args, site: " C.TEST " });
  expect(search.page).toEqual([]);
  expect(search.isDone).toBe(false);
  const matches = await t.admin.query(api.scout.sites.list, {
    ...args,
    site: " C.TEST ",
    paginationOpts: { cursor: search.continueCursor, numItems: 2 },
  });
  expect(matches.page).toEqual([
    { hostname: "c.test", taskCount: 0, preview: null, profile: null, research: null },
  ]);
});

test("unassigned task pagination includes only the owner's review tasks without a site", async () => {
  const t = await setup();
  const pending = await t.review(null, 1, { decision: "pending" });
  const rejected = await t.review(null, 2, { decision: "rejected" });
  const failed = await t.review(null, 3, { decision: "pending", visibility: "private" });
  await t.backend.mutation(internal.tasks.requestChecks.finish, {
    checkId: failed.checkId,
    state: { kind: "failed", finishedAt: 4, call: null, error: "Research failed" },
  });
  await t.review("assigned.test", 4);
  await t.review(null, 5, { userId: t.otherId });
  const first = await t.owner.query(api.scout.activity.unassigned, {
    paginationOpts: { cursor: null, numItems: 2 },
  });
  const second = await t.owner.query(api.scout.activity.unassigned, {
    paginationOpts: { cursor: first.continueCursor, numItems: 2 },
  });
  expect([...first.page, ...second.page].map((row) => row.threadId)).toEqual([
    failed.sessionId,
    rejected.sessionId,
    pending.sessionId,
  ]);
  expect(second.isDone).toBe(true);
  await expect(
    t.backend.query(api.scout.activity.unassigned, {
      paginationOpts: { cursor: null, numItems: 2 },
    }),
  ).rejects.toThrow("Not authorized");
  await t.owner.mutation(api.scout.reviewSites.set, {
    threadId: pending.sessionId,
    site: "assigned.test",
  });
  expect(
    (
      await t.owner.query(api.scout.activity.unassigned, {
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page.map((row) => row.threadId),
  ).toEqual([failed.sessionId, rejected.sessionId]);
});

test("manual backfill uses bounded resumable pages and is idempotent for existing tasks and workspaces", async () => {
  const t = await setup();
  for (let i = 0; i < 70; i++) await t.review(`site-${i}.test`, i, { legacy: true });
  await t.review("private.test", 100, { legacy: true, visibility: "private" });
  await t.review("pending.test", 101, { legacy: true, decision: "pending" });
  await t.backend.run((ctx) =>
    ctx.db.insert("scoutWorkspaces", {
      kind: "site",
      site: "workspace.test",
      cwd: "/workspace",
      revision: 0,
    }),
  );
  expect((await t.list("public")).page).toEqual([]);
  const first = await t.backend.mutation(internal.scout.sites.backfill, {
    source: "chats",
    cursor: null,
  });
  expect(first.processed).toBe(32);
  expect(first.isDone).toBe(false);
  expect(
    await t.backend.mutation(internal.scout.sites.backfill, { source: "chats", cursor: null }),
  ).toEqual(first);
  const second = await t.backend.mutation(internal.scout.sites.backfill, {
    source: "chats",
    cursor: first.continueCursor,
  });
  const third = await t.backend.mutation(internal.scout.sites.backfill, {
    source: "chats",
    cursor: second.continueCursor,
  });
  expect(second.processed).toBe(32);
  expect(third).toMatchObject({ isDone: true, processed: 8 });
  await t.backend.mutation(internal.scout.sites.backfill, { source: "workspaces", cursor: null });
  await t.backend.mutation(internal.scout.sites.backfill, { source: "workspaces", cursor: null });
  expect(await t.admin.query(api.scout.sites.get, { site: "workspace.test" })).toEqual({
    hostname: "workspace.test",
    preview: null,
    profile: null,
    research: null,
  });
  const a = await t.list("public");
  const b = await t.list("public", a.continueCursor);
  const c = await t.list("public", b.continueCursor);
  const names = [...a.page, ...b.page, ...c.page].map((row) => row.hostname);
  expect(names).toEqual(Array.from({ length: 70 }, (_, i) => `site-${69 - i}.test`));
  expect(new Set(names).size).toBe(70);
  expect([...a.page, ...b.page, ...c.page].every((site) => site.taskCount === 1)).toBe(true);
  expect(c.isDone).toBe(true);
});

test("account deletion removes all owner listings in batches and keeps retained public task history", async () => {
  const t = await setup();
  for (let i = 0; i < 70; i++) {
    const task = await t.review(`site-${i}.test`, i);
    await t.backend.run((ctx) =>
      ctx.db.patch(task.sessionId, { active: false, state: { kind: "idle" } }),
    );
  }
  await t.review("shared.test", 100, { userId: t.otherId });
  const sessionId = await t.backend.run((ctx) =>
    ctx.db.insert("authSessions", { userId: t.userId, expirationTime: Date.now() + 60_000 }),
  );
  const deleting = t.backend.withIdentity({ subject: `${t.userId}|${sessionId}` });
  await deleting.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  await expect(t.list("mine")).rejects.toThrow("Not authorized");
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers, 1000);
  expect(await deleting.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  expect(
    await t.backend.run((ctx) =>
      ctx.db
        .query("siteUserListings")
        .withIndex("by_user_id_and_hostname", (q) => q.eq("userId", t.userId))
        .collect(),
    ),
  ).toEqual([]);
  await t.backend.mutation(internal.scout.sites.backfill, { source: "chats", cursor: null });
  expect(
    await t.backend.run((ctx) =>
      ctx.db
        .query("siteUserListings")
        .withIndex("by_user_id_and_hostname", (q) => q.eq("userId", t.userId))
        .first(),
    ),
  ).toBeNull();
  expect(await t.backend.query(api.scout.sites.get, { site: "site-69.test" })).toEqual({
    hostname: "site-69.test",
    preview: null,
    profile: null,
    research: null,
  });
  expect(
    (
      await t.other.query(api.scout.sites.list, {
        scope: "mine",
        site: null,
        paginationOpts: { cursor: null, numItems: 24 },
      })
    ).page,
  ).toEqual([
    { hostname: "shared.test", taskCount: 1, preview: null, profile: null, research: null },
  ]);
});

test.each([undefined, "A public calculator."])(
  "site details expose overview=%s, lists stay lightweight, and diagnostics stay private",
  async (overview) => {
    const t = await setup();
    await t.review("example.test", 1);
    await t.backend.run(async (ctx) => {
      const site = await ctx.db
        .query("sites")
        .withIndex("by_hostname", (q) => q.eq("hostname", "example.test"))
        .unique();
      if (!site) throw new Error("Missing site");
      const researchId = await ctx.db.insert("agentsApiSiteResearch", {
        site: site.hostname,
        sessionId: null,
        userId: t.userId,
        model: "spark-2",
        maxCredits: 50,
        jobId: "job-1",
        requestPath: null,
        responsePath: null,
        credits: null,
        state: { kind: "failed", finishedAt: 20, error: "Provider diagnostic for operators" },
      });
      await ctx.db.patch(site._id, {
        researchId,
        profile: {
          name: "Example App",
          homepageUrl: "https://example.test/",
          researchedAt: 10,
          brief: "Public brief",
          ...omitNullish({ overview }),
        },
      });
    });
    for (const viewer of [t.backend, t.owner]) {
      const site = await viewer.query(api.scout.sites.get, { site: "example.test" });
      expect(site?.profile).toEqual({
        name: "Example App",
        homepageUrl: "https://example.test/",
        researchedAt: 10,
        ...omitNullish({ overview }),
      });
      expect(site?.research).toEqual({ status: "failed", error: null });
      const page = await viewer.query(api.scout.sites.list, {
        scope: "public",
        site: null,
        paginationOpts: { cursor: null, numItems: 6 },
      });
      expect(page.page[0].research).toEqual({ status: "failed", error: null });
      expect(page.page[0].profile).toEqual({
        name: "Example App",
        homepageUrl: "https://example.test/",
        researchedAt: 10,
      });
    }
    expect((await t.admin.query(api.scout.sites.get, { site: "example.test" }))?.research).toEqual({
      status: "failed",
      error: "Provider diagnostic for operators",
    });
  },
);

test("search matches partial names and domains across bounded pages without exposing private sites", async () => {
  const t = await setup();
  await t.review("older-app.test", 1);
  await t.review("pika.style", 2);
  await t.review("unrelated.test", 3);
  await t.review("pika-private.test", 4, { userId: t.otherId, visibility: "private" });
  await t.backend.run(async (ctx) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_hostname", (q) => q.eq("hostname", "older-app.test"))
      .unique();
    if (!site) throw new Error("Missing site");
    await ctx.db.patch(site._id, {
      profile: {
        name: "Pika Studio",
        homepageUrl: "https://older-app.test",
        researchedAt: 10,
        brief: "Site brief",
      },
    });
  });
  for (const scope of ["public", "mine"] as const) {
    const first = await t.list(scope, null, 1, " PIKA ");
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const second = await t.list(scope, first.continueCursor, 1, " PIKA ");
    const third = await t.list(scope, second.continueCursor, 1, " PIKA ");
    expect([...second.page, ...third.page].map((site) => site.hostname)).toEqual([
      "pika.style",
      "older-app.test",
    ]);
    expect((await t.list(scope, null, 24, "studio")).page.map((site) => site.hostname)).toEqual([
      "older-app.test",
    ]);
    expect((await t.list(scope, null, 24, "ika")).page.map((site) => site.hostname)).toEqual([
      "pika.style",
      "older-app.test",
    ]);
  }
  const privateMatch = await t.other.query(api.scout.sites.list, {
    scope: "mine",
    site: "pika",
    paginationOpts: { cursor: null, numItems: 24 },
  });
  expect(privateMatch.page.map((site) => site.hostname)).toEqual(["pika-private.test"]);
});
