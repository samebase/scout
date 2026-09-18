/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup(email: string) {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  agentTest.register(backend);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => ({
    userId: await insertTestAccount(ctx, { email }),
    otherId: await insertTestAccount(ctx, { email: "other@example.test" }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Product Scout",
      websiteIdentity: { firstName: "Product", lastName: "Scout" },
      slug: "product-scout",
      status: "active",
      agentMail: { inboxId: "product", address: "product@example.test" },
      firecrawl: { profileName: "product" },
    }),
  }));
  return {
    backend,
    ...ids,
    owner: backend.withIdentity({ subject: ids.userId }),
    other: backend.withIdentity({ subject: ids.otherId }),
  };
}

test.each([
  { kind: "review", email: "member@example.test" },
  { kind: "play", email: "member@example.test" },
  { kind: "review", email: ADMIN_EMAIL },
  { kind: "play", email: ADMIN_EMAIL },
] as const)("$email starts $kind through the shared task pipeline", async ({ kind, email }) => {
  const t = await setup(email);
  const { threadId } = await t.owner.mutation(api.scout.chats.startProductChat, {
    kind,
    scoutId: t.scoutId,
    prompt: "  Try the game with me.  ",
    visibility: "public",
  });
  const persisted = await t.backend.run(async (ctx) => {
    const sessionId = ctx.db.normalizeId("agentsApiSessions", threadId);
    if (!sessionId) throw new Error("Product did not create a task session");
    return {
      session: await ctx.db.get(sessionId),
      chat: await ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
        .unique(),
      check: await ctx.db
        .query("agentsApiRequestChecks")
        .withIndex("by_session_id_and_kind", (q) =>
          q.eq("sessionId", sessionId).eq("kind", "initial"),
        )
        .unique(),
      legacyTurns: await ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
        .take(1),
    };
  });
  expect(persisted.session).toMatchObject({
    userId: t.userId,
    scoutId: t.scoutId,
    engine: "agents_api",
    state: { kind: "starting" },
    active: true,
    workflowId: expect.any(String),
  });
  expect(persisted.chat).toMatchObject({
    runtime: { kind: "agents_api", sessionId: threadId },
    purpose: kind === "play" ? { kind, step: null } : { kind },
    visibility: "public",
    publicSiteEligible: false,
  });
  expect(persisted.check).toMatchObject({
    prompt: "Try the game with me.",
    state: { kind: "pending" },
  });
  expect(persisted.legacyTurns).toEqual([]);
  expect(await t.owner.query(api.scout.activity.get, { threadId })).toMatchObject({
    runtime: { kind: "task", sessionId: threadId },
    canControl: true,
  });
  expect(await t.other.query(api.scout.activity.get, { threadId })).toBeNull();
  expect(await t.backend.query(api.scout.activity.get, { threadId })).toBeNull();
  await expect(
    t.owner.mutation(api.scout.chats.startProductChat, {
      kind,
      scoutId: t.scoutId,
      prompt: "Second task",
      visibility: "private",
    }),
  ).rejects.toThrow("already working");
});

test("stored Convex product history stays readable without execution controls or fake task IDs", async () => {
  const t = await setup("member@example.test");
  const thread = await t.backend.mutation(components.agent.threads.createThread, {
    userId: t.userId,
    title: "Old game",
  });
  await t.backend.mutation(components.agent.messages.addMessages, {
    threadId: thread._id,
    messages: [{ message: { role: "assistant", content: "The game ended in a draw." } }],
  });
  const chatId = await t.backend.run((ctx) =>
    ctx.db.insert("scoutChats", {
      userId: t.userId,
      scoutId: t.scoutId,
      threadId: thread._id,
      runtime: { kind: "convex_agent" },
      purpose: { kind: "play", step: "play" },
      visibility: "private",
      createdAt: Date.now(),
    }),
  );
  const before = await t.backend.run((ctx) => ctx.db.get(chatId));
  expect(await t.owner.query(api.scout.activity.get, { threadId: thread._id })).toMatchObject({
    runtime: { kind: "convex_agent" },
    title: "Old game",
    isOwner: true,
    canControl: false,
  });
  expect(
    await t.owner.query(api.scout.activity.messages, {
      threadId: thread._id,
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  ).toMatchObject({ page: [{ text: "The game ended in a draw." }] });
  expect(await t.backend.run((ctx) => ctx.db.get(chatId))).toEqual(before);
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiSessions").first())).toBeNull();
});

test.each(["review", "play"] as const)(
  "unapproved members cannot create %s tasks",
  async (kind) => {
    const t = await setup("unapproved@example.test");
    await t.backend.run((ctx) => ctx.db.patch(t.userId, { isApproved: false }));
    await expect(
      t.owner.mutation(api.scout.chats.startProductChat, {
        kind,
        scoutId: t.scoutId,
        prompt: "Start a task",
        visibility: "private",
      }),
    ).rejects.toThrow("Not authorized");
    expect(await t.backend.run((ctx) => ctx.db.query("agentsApiSessions").first())).toBeNull();
  },
);
