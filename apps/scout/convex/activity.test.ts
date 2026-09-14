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
  vi.unstubAllEnvs();
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
  async function review(visibility: Doc<"scoutChats">["visibility"] = "public") {
    const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
      kind: "review",
      scoutId,
      prompt: "Try this product's onboarding.",
      visibility,
    });
    const sessionId = await backend.run(async (ctx) =>
      ctx.db.normalizeId("agentsApiSessions", threadId),
    );
    if (!sessionId) throw new Error("Expected a managed Review");
    return sessionId;
  }
  return { backend, member, other, memberId, otherId, adminId, scoutId, chat, review };
}

test("managed Reviews share the feed and expose only conversation text and watch-only browser access", async () => {
  const t = await setup();
  const oldReview = await t.chat({ kind: "review" }, "public");
  vi.advanceTimersByTime(1);
  const sessionId = await t.review();
  await t.backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "user",
        kind: "user",
        text: "Try the site",
        details: "private request metadata",
      },
      { providerItemId: "reasoning", kind: "reasoning", text: "private reasoning", details: "" },
      {
        providerItemId: "tool",
        kind: "function_call_output",
        text: "private inbox contents",
        details: "private token",
      },
      {
        providerItemId: "assistant",
        kind: "assistant",
        text: "I opened the site.",
        details: "private provider metadata",
      },
    ],
  });
  const messages = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(messages.page).toEqual([
    { id: expect.any(String), role: "assistant", text: "I opened the site." },
  ]);
  const earlier = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { numItems: 1, cursor: messages.continueCursor },
  });
  expect(earlier.page).toEqual([{ id: expect.any(String), role: "user", text: "Try the site" }]);
  const feed = await t.backend.query(api.scout.activity.list, {
    kind: "review",
    scope: "public",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(feed.page.map((item) => item.threadId)).toEqual([sessionId]);
  const next = await t.backend.query(api.scout.activity.list, {
    kind: "review",
    scope: "public",
    paginationOpts: { numItems: 1, cursor: feed.continueCursor },
  });
  expect(next.page.map((item) => item.threadId)).toEqual([oldReview.threadId]);
  await t.backend.mutation(internal.agentsApi.browsers.open, {
    sessionId,
    browser: {
      providerSessionId: "private-provider-id",
      cdpUrl: "wss://private-cdp",
      liveViewUrl: "https://liveview.firecrawl.dev/watch-only",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
      currentUrl: null,
    },
  });
  const view = await t.backend.query(api.scout.activity.get, { threadId: sessionId });
  expect(view).toMatchObject({
    isOwner: false,
    canControl: false,
    runtime: { kind: "agents_api", sessionId },
  });
  expect(JSON.stringify(view)).not.toMatch(/private|cdp|inbox|profile/);
  const browser = view?.sessions[0];
  if (browser?.engine !== "agents_api") throw new Error("Expected a managed browser");
  expect(
    await t.backend.query(api.scout.activity.liveView, { sessionId: browser.sessionId }),
  ).toEqual({ url: "https://liveview.firecrawl.dev/watch-only" });
  expect(
    await t.backend.query(internal.agentsApi.browsers.replayData, { sessionId: browser.sessionId }),
  ).not.toBeNull();
  await expect(t.other.query(api.agentsApi.sessions.controls, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(
    t.other.mutation(api.agentsApi.sessions.send, { sessionId, message: "Take over" }),
  ).rejects.toThrow("Session not found");
  await expect(t.other.mutation(api.agentsApi.sessions.resume, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(t.other.mutation(api.agentsApi.sessions.stop, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await t.member.mutation(api.scout.chats.setVisibility, {
    threadId: sessionId,
    visibility: "private",
  });
  expect(
    await t.backend.query(api.scout.activity.liveView, { sessionId: browser.sessionId }),
  ).toBeNull();
  expect(
    await t.backend.query(internal.agentsApi.browsers.replayData, { sessionId: browser.sessionId }),
  ).toBeNull();
  expect(
    await t.backend.query(api.scout.activity.messages, {
      threadId: sessionId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).toMatchObject({ page: [] });
  expect(
    await t.member.query(internal.agentsApi.browsers.replayData, { sessionId: browser.sessionId }),
  ).not.toBeNull();
});

test("Review owners can resume handoffs, stop, and send follow-ups while Lab remains private", async () => {
  const t = await setup();
  const sessionId = await t.review("private");
  await t.backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    state: { kind: "running" },
    providerId: "provider",
  });
  await t.backend.mutation(internal.agentsApi.browsers.open, {
    sessionId,
    browser: {
      providerSessionId: "provider-browser",
      cdpUrl: "wss://private-cdp",
      liveViewUrl: "https://liveview.firecrawl.dev/watch-only",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
      currentUrl: null,
    },
  });
  await t.backend.mutation(internal.agentsApi.sessions.enterHandoff, {
    sessionId,
    message: "Complete verification",
    callId: "handoff",
    turnId: "turn",
  });
  const controls = await t.member.query(api.agentsApi.sessions.controls, { sessionId });
  expect(controls).toMatchObject({
    state: { kind: "waiting" },
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
  });
  const delivery = await t.backend.query(internal.agentsApi.sessions.handoffNotification, {
    sessionId,
    callId: "handoff",
  });
  expect(delivery).toMatchObject({ recipient: "player@example.test", inboxId: "private-inbox" });
  vi.stubEnv("SITE_URL", "http://localhost:5173");
  vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
  const sendMail = vi.fn(
    async () => new Response(JSON.stringify({ message_id: "email", thread_id: "email-thread" })),
  );
  vi.stubGlobal("fetch", sendMail);
  await t.backend.action(internal.agentsApi.handoff.notify, { sessionId, callId: "handoff" });
  expect(sendMail).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining(`http://localhost:5173/review?thread=${sessionId}`),
    }),
  );
  expect(sendMail).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining('"to":["player@example.test"]'),
    }),
  );
  await t.member.mutation(api.agentsApi.sessions.resume, { sessionId });
  expect(
    await t.backend.query(internal.agentsApi.sessions.handoffNotification, {
      sessionId,
      callId: "handoff",
    }),
  ).toBeNull();
  await t.backend.action(internal.agentsApi.handoff.notify, { sessionId, callId: "handoff" });
  expect(sendMail).toHaveBeenCalledTimes(1);
  await t.member.mutation(api.agentsApi.sessions.stop, { sessionId });
  expect(await t.member.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
    status: "stopping",
  });
  await t.backend.mutation(internal.agentsApi.sessions.update, { sessionId, active: false });
  await t.backend.mutation(internal.agentsApi.browsers.close, {
    providerSessionId: "provider-browser",
    providerDurationMs: null,
    creditsBilled: null,
  });
  await t.member.mutation(api.agentsApi.sessions.send, {
    sessionId,
    message: "Check another page",
  });
  expect(await t.member.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
    status: "running",
  });
  await expect(
    t.member.query(api.agentsApi.sessions.listItems, {
      sessionId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).rejects.toThrow("Not authorized");
});

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

test("Review starts an Agents API session for a member without Lab permission", async () => {
  const t = await setup();
  const selection = { model: "openai/gpt-5.6-luna", reasoningEffort: "high" } as const;
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { defaultScoutModelSelection: selection }));
  const { threadId } = await t.member.mutation(api.scout.chats.startProductChat, {
    kind: "review",
    scoutId: t.scoutId,
    prompt: "Try this product's onboarding.",
    visibility: "private",
  });
  expect(await t.backend.run((ctx) => ctx.db.query("scoutTurns").first())).toBeNull();
  const sessionId = await t.backend.run(async (ctx) =>
    ctx.db.normalizeId("agentsApiSessions", threadId),
  );
  if (!sessionId) throw new Error("Expected a managed session");
  expect(await t.backend.query(internal.agentsApi.sessions.runtime, { sessionId })).toMatchObject({
    purpose: { kind: "review" },
    session: { model: "gpt-5.6-luna", active: true },
  });
  await expect(t.member.query(api.agentsApi.sessions.get, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  expect(await t.member.query(api.agentsApi.sessions.controls, { sessionId })).toMatchObject({
    canStop: true,
    canSend: false,
  });
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
  await expect(t.backend.query(internal.agentsApi.sessions.runtime, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  await expect(
    t.member.mutation(api.scout.chats.startProductChat, {
      kind: "review",
      scoutId: t.scoutId,
      prompt: "Another review",
      visibility: "private",
    }),
  ).rejects.toThrow("Not authorized");
});

test("managed Reviews stay in the Agents inspector without breaking the Convex Lab list", async () => {
  const t = await setup();
  const admin = t.backend.withIdentity({ subject: t.adminId });
  const existing = await t.chat({ kind: "general" }, "private", t.adminId);
  await admin.mutation(api.scout.chats.startProductChat, {
    kind: "review",
    scoutId: t.scoutId,
    prompt: "Try a site",
    visibility: "private",
  });
  const chats = await admin.query(api.scout.chats.listThreads, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(chats.page.map(({ threadId }) => threadId)).toEqual([existing.threadId]);
  expect(
    (
      await admin.query(api.agentsApi.sessions.list, {
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toHaveLength(1);
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
  expect(turn).toMatchObject({ model: "openai/gpt-5.6-luna", reasoningEffort: "max" });
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
