import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  agentTest.register(backend);
  workflowTest.register(backend);
  const { memberId, otherId, adminId, scoutId } = await backend.run(async (ctx) => ({
    memberId: await insertTestAccount(ctx, { email: "player@example.test" }),
    otherId: await insertTestAccount(ctx, { email: "other@example.test" }),
    adminId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Play Scout",
      slug: "play-scout",
      websiteIdentity: { firstName: "Play", lastName: "Scout" },
      status: "active",
      agentMail: { inboxId: "private-inbox", address: "scout@example.test" },
      firecrawl: { profileName: "private-profile" },
    }),
  }));
  const member = backend.withIdentity({ subject: `${memberId}|session` });
  const other = backend.withIdentity({ subject: `${otherId}|session` });
  async function chat(
    purpose: Doc<"scoutChats">["purpose"],
    visibility: Doc<"scoutChats">["visibility"],
    userId: Id<"users"> = memberId,
  ) {
    const thread = await backend.mutation(components.agent.threads.createThread, {
      userId,
      title: `${visibility} ${purpose.kind}`,
    });
    const chatId = await backend.run((ctx) =>
      ctx.db.insert("scoutChats", {
        userId,
        scoutId,
        threadId: thread._id,
        createdAt: Date.now(),
        purpose,
        visibility,
      }),
    );
    return { threadId: thread._id, chatId };
  }
  return { backend, member, other, memberId, otherId, adminId, scoutId, chat };
}

test("paginates public games separately from reviews and private chats", async () => {
  const t = await setup();
  const first = await t.chat({ kind: "play", step: null }, "public");
  vi.advanceTimersByTime(1);
  const second = await t.chat({ kind: "play", step: null }, "public", t.otherId);
  const ownPrivate = await t.chat({ kind: "play", step: null }, "private");
  const otherPrivate = await t.chat({ kind: "play", step: null }, "private", t.otherId);
  const review = await t.chat({ kind: "review" }, "public");
  await t.chat({ kind: "general" }, "public", t.adminId);
  const all = await t.backend.query(api.scout.activity.list, {
    kind: "all",
    scope: "public",
    paginationOpts: { cursor: null, numItems: 2 },
  });
  expect(all.page.map((row) => row.threadId)).toEqual([review.threadId, second.threadId]);
  expect(
    (
      await t.backend.query(api.scout.activity.list, {
        kind: "all",
        scope: "public",
        paginationOpts: { cursor: all.continueCursor, numItems: 2 },
      })
    ).page.map((row) => row.threadId),
  ).toEqual([first.threadId]);
  await t.chat({ kind: "general" }, "private");
  expect(
    (
      await t.member.query(api.scout.activity.list, {
        kind: "all",
        scope: "mine",
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page.map((row) => row.threadId),
  ).toEqual([review.threadId, ownPrivate.threadId, first.threadId]);
  const list = (cursor: string | null) =>
    t.backend.query(api.scout.activity.list, {
      kind: "play",
      scope: "public",
      paginationOpts: { cursor, numItems: 1 },
    });
  const page = await list(null);
  expect(page.page.map((row) => row.threadId)).toEqual([second.threadId]);
  expect((await list(page.continueCursor)).page.map((row) => row.threadId)).toEqual([
    first.threadId,
  ]);
  const mine = await t.member.query(api.scout.activity.list, {
    kind: "play",
    scope: "mine",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(mine.page.map((row) => row.threadId)).toEqual([ownPrivate.threadId, first.threadId]);
  expect(
    (
      await t.backend.query(api.scout.activity.list, {
        kind: "review",
        scope: "public",
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page.map((row) => row.threadId),
  ).toEqual([review.threadId]);
  await expect(
    t.backend.query(api.scout.activity.list, {
      kind: "play",
      scope: "mine",
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  ).rejects.toThrow("Not authorized");
  expect(
    await t.member.query(api.scout.activity.get, { threadId: otherPrivate.threadId }),
  ).toBeNull();
  const publicGame = await t.backend.query(api.scout.activity.get, { threadId: first.threadId });
  expect(publicGame).toMatchObject({ isOwner: false, canControl: false });
  expect(JSON.stringify(publicGame)).not.toMatch(
    /private-inbox|private-profile|scout@example|userId/,
  );
  await t.backend.run((ctx) => ctx.db.patch(first.chatId, { visibility: "private" }));
  expect(await t.backend.query(api.scout.activity.get, { threadId: first.threadId })).toBeNull();
  expect(await t.member.query(api.scout.activity.get, { threadId: first.threadId })).toMatchObject({
    canControl: true,
  });
});

test("Review uses the same execution path with its own permission and runtime purpose", async () => {
  const t = await setup();
  const { threadId } = await t.member.mutation(api.scout.chats.startProductChat, {
    kind: "review",
    scoutId: t.scoutId,
    prompt: "Try this product's onboarding.",
    visibility: "private",
  });
  const turn = await t.backend.run((ctx) => ctx.db.query("scoutTurns").first());
  if (!turn) throw new Error("Expected the first review turn");
  expect(
    await t.backend.query(internal.scout.chats.runtimeContext, {
      promptMessageId: turn.promptMessageId,
    }),
  ).toMatchObject({ purpose: { kind: "review" } });
  expect(await t.member.query(api.scout.activity.get, { threadId })).toMatchObject({
    purpose: { kind: "review" },
    canControl: true,
    visibility: "private",
  });
  expect(await t.backend.query(api.scout.activity.get, { threadId })).toBeNull();
  await expect(
    t.other.mutation(api.scout.chats.startProductChat, {
      kind: "play",
      scoutId: t.scoutId,
      prompt: "Play with me",
      visibility: "private",
    }),
  ).rejects.toThrow("busy");
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { isApproved: false }));
  await expect(
    t.member.mutation(api.scout.chats.startProductChat, {
      kind: "review",
      scoutId: t.scoutId,
      prompt: "Another review",
      visibility: "private",
    }),
  ).rejects.toThrow("Not authorized");
});

test("members can start and continue Play, but cannot run Lab chats or another player's chat", async () => {
  const t = await setup();
  const { threadId } = await t.member.mutation(api.scout.chats.startProductChat, {
    kind: "play",
    scoutId: t.scoutId,
    prompt: "Play one game with me.",
    visibility: "public",
  });
  const turn = await t.backend.run((ctx) => ctx.db.query("scoutTurns").first());
  if (!turn) throw new Error("Expected the first turn");
  expect(turn.state.kind).toBe("pending");
  expect(await t.backend.query(api.scout.activity.get, { threadId })).toMatchObject({
    status: "running",
    purpose: { kind: "play", step: null },
    visibility: "public",
  });
  expect(await t.backend.query(api.scout.activity.players)).toEqual([
    {
      _id: t.scoutId,
      displayName: "Play Scout",
      status: "active",
      busy: true,
    },
  ]);
  await expect(
    t.other.mutation(api.scout.chats.startProductChat, {
      kind: "play",
      scoutId: t.scoutId,
      prompt: "Play with me too",
      visibility: "public",
    }),
  ).rejects.toThrow("busy");
  expect(await t.backend.run((ctx) => ctx.db.query("scoutChats").collect())).toHaveLength(1);
  await expect(t.other.mutation(api.scout.chats.stop, { threadId })).rejects.toThrow(
    "Thread not found",
  );
  await expect(
    t.other.mutation(api.scout.chats.sendMessage, { threadId, prompt: "Take over" }),
  ).rejects.toThrow("Thread not found");
  await t.backend.mutation(internal.scout.turns.complete, {
    promptMessageId: turn.promptMessageId,
    usage: {},
  });
  await t.member.mutation(api.scout.chats.sendMessage, { threadId, prompt: "Another game?" });
  expect(await t.member.query(api.scout.chats.getScoutActivity, { threadId })).toMatchObject({
    kind: "running",
  });
  const general = await t.chat({ kind: "general" }, "private");
  await expect(
    t.member.mutation(api.scout.chats.sendMessage, {
      threadId: general.threadId,
      prompt: "Run Lab tools",
    }),
  ).rejects.toThrow("Not authorized");
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { isApproved: false }));
  expect(await t.member.query(api.scout.activity.get, { threadId })).toMatchObject({
    canControl: false,
  });
  await expect(
    t.member.mutation(api.scout.chats.sendMessage, { threadId, prompt: "Continue" }),
  ).rejects.toThrow("Not authorized");
  await expect(
    t.member.mutation(api.scout.chats.startProductChat, {
      kind: "play",
      scoutId: t.scoutId,
      prompt: "New game",
      visibility: "private",
    }),
  ).rejects.toThrow("Not authorized");
});

test("public messages expose conversation text without tools or reasoning, in pagination order", async () => {
  const t = await setup();
  const { threadId } = await t.chat({ kind: "play", step: null }, "public");
  await t.backend.mutation(components.agent.messages.addMessages, {
    threadId,
    messages: [
      { message: { role: "system", content: "private instructions" } },
      { message: { role: "user", content: "Join my game" } },
      {
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "private reasoning" },
            { type: "text", text: "I'll join now." },
            {
              type: "tool-call",
              toolCallId: "browser",
              toolName: "browser_execute",
              args: { code: "private code" },
            },
          ],
        },
      },
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "browser",
              toolName: "browser_execute",
              output: { type: "text", value: "private browser result" },
            },
          ],
        },
      },
    ],
  });
  const result = await t.backend.query(api.scout.activity.messages, {
    threadId,
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(result.page.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "assistant", text: "I'll join now." },
    { role: "user", text: "Join my game" },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/private|tool|reasoning/);
});

test("public browser endpoints exclude control credentials and reject private sessions before contacting Firecrawl", async () => {
  const t = await setup();
  const { threadId, chatId } = await t.chat({ kind: "play", step: null }, "public");
  const { sessionId } = await t.backend.mutation(internal.scout.browserSessions.open, {
    threadId,
    scoutId: t.scoutId,
    source: { kind: "manual" },
    providerSessionId: "provider-id",
    cdpUrl: "wss://browser.firecrawl.dev/private-cdp",
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
    providerExpiresAtMs: Date.now() + 60_000,
    profileName: "private-profile",
  });
  await t.backend.mutation(internal.scout.browserSessions.setLiveView, {
    sessionId,
    liveViewUrl: "https://liveview.firecrawl.dev/watch-only",
  });
  expect(await t.backend.query(api.scout.activity.liveView, { sessionId })).toEqual({
    url: "https://liveview.firecrawl.dev/watch-only",
  });
  const view = await t.backend.query(api.scout.activity.get, { threadId });
  expect(JSON.stringify(view)).not.toMatch(/cdp|private-control|provider-id|private-profile/);
  expect(
    await t.backend.query(internal.scout.browserSessions.replayData, { sessionId }),
  ).toMatchObject({ operations: [] });
  await t.backend.run((ctx) => ctx.db.patch(chatId, { visibility: "private" }));
  expect(await t.backend.query(api.scout.activity.liveView, { sessionId })).toBeNull();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await t.backend.action(api.browserReplay.listPages, { sessionId })).toEqual({
    status: "unavailable",
  });
  expect(await t.other.action(api.browserReplay.loadPlaylist, { sessionId, pageId: "1" })).toEqual({
    status: "unavailable",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(
    await t.backend.query(api.scout.activity.messages, {
      threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  ).toMatchObject({ page: [], isDone: true });
});

test("only owners can publish and they can make a game private even after approval is revoked", async () => {
  const t = await setup();
  const { threadId } = await t.chat({ kind: "play", step: null }, "private");
  await expect(
    t.other.mutation(api.scout.chats.setVisibility, { threadId, visibility: "public" }),
  ).rejects.toThrow("Chat not found");
  await t.member.mutation(api.scout.chats.setVisibility, { threadId, visibility: "public" });
  expect(await t.backend.query(api.scout.activity.get, { threadId })).not.toBeNull();
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { isApproved: false }));
  await t.member.mutation(api.scout.chats.setVisibility, { threadId, visibility: "private" });
  expect(await t.backend.query(api.scout.activity.get, { threadId })).toBeNull();
  await expect(
    t.member.mutation(api.scout.chats.setVisibility, { threadId, visibility: "public" }),
  ).rejects.toThrow("Not authorized");
});
