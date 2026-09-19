/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import { omitNullish } from "../shared/omitNullish";
import { syncChatSite } from "./scout/siteListings";

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
        publicSiteEligible: purpose.kind === "review" && visibility === "public",
      }),
    );
    return { threadId: thread._id, chatId };
  }
  async function review(visibility: Doc<"scoutChats">["visibility"] = "public") {
    const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
      selection: { engine: "agents_api", model: "gpt-5.6-luna" },
      product: { kind: "review" },
      scoutId,
      prompt: "Try this product's onboarding.",
      visibility,
    });
    const sessionId = await backend.run(async (ctx) =>
      ctx.db.normalizeId("agentsApiSessions", threadId),
    );
    if (!sessionId) throw new Error("Expected a managed Review");
    const check = await backend.run((ctx) =>
      ctx.db
        .query("agentsApiRequestChecks")
        .withIndex("by_session_id_and_kind", (q) =>
          q.eq("sessionId", sessionId).eq("kind", "initial"),
        )
        .unique(),
    );
    if (!check) throw new Error("Expected an initial check");
    await backend.mutation(internal.tasks.requestChecks.start, {
      checkId: check._id,
      startedAt: Date.now(),
      request: "{}",
      evidence: null,
    });
    await backend.mutation(internal.tasks.requestChecks.finish, {
      checkId: check._id,
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
        result: {
          kind: "initial",
          title: "Test product onboarding",
          decision: { kind: "approved" },
        },
      },
    });
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      providerId: "provider-review",
      state: { kind: "running" },
    });
    return sessionId;
  }
  async function managedReview(site: string | null) {
    return backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("agentsApiSessions", {
        userId: memberId,
        scoutId,
        scoutName: "Play Scout",
        title: "Review the signup flow",
        model: "gpt-5.6-luna",
        state: { kind: "idle" },
        active: false,
        nextSequence: 0,
        browser: null,
        usage: null,
      });
      const chatId = await ctx.db.insert("scoutChats", {
        threadId: sessionId,
        userId: memberId,
        scoutId,
        createdAt: Date.now(),
        runtime: { kind: "agents_api", sessionId },
        purpose: { kind: "review" },
        visibility: "public",
        publicSiteEligible: true,
        ...omitNullish({ primarySite: site }),
      });
      const checkId = await ctx.db.insert("agentsApiRequestChecks", {
        sessionId,
        kind: "initial",
        model: "gpt-5.6-luna",
        prompt: "private initial request",
        state: {
          kind: "completed",
          finishedAt: Date.now(),
          call: { startedAt: Date.now(), request: "private metadata", response: "{}", usage: null },
          result: {
            kind: "initial",
            title: "Review the signup flow",
            decision: { kind: "approved" },
          },
        },
      });
      return { sessionId, chatId, checkId };
    });
  }
  return {
    backend,
    member,
    other,
    memberId,
    otherId,
    adminId,
    scoutId,
    chat,
    review,
    managedReview,
  };
}

test("one feed supports site groups, the first three reviews, and paginated inline history", async () => {
  const t = await setup();
  const otherSite = await t.managedReview("other.test");
  const unassigned = await t.managedReview(null);
  const reviews = [];
  for (let i = 0; i < 8; i++) {
    vi.advanceTimersByTime(1);
    reviews.unshift(await t.managedReview("example.test"));
  }
  const feed = await t.backend.query(api.scout.activity.list, {
    scope: "public",
    site: null,
    paginationOpts: { cursor: null, numItems: 24 },
  });
  expect(feed.page.map((review) => review.threadId)).toEqual([
    ...reviews.map((review) => review.sessionId),
    unassigned.sessionId,
    otherSite.sessionId,
  ]);
  expect(feed.isDone).toBe(true);
  const history = (cursor: string | null) =>
    t.backend.query(api.scout.activity.list, {
      scope: "public",
      site: " EXAMPLE.TEST ",
      paginationOpts: { cursor, numItems: 3 },
    });
  const first = await history(null);
  const second = await history(first.continueCursor);
  const third = await history(second.continueCursor);
  expect(first.page.map((review) => review.threadId)).toEqual(
    feed.page
      .filter((review) => review.primarySite === "example.test")
      .slice(0, 3)
      .map((review) => review.threadId),
  );
  expect([...first.page, ...second.page, ...third.page].map((review) => review.threadId)).toEqual(
    reviews.map((review) => review.sessionId),
  );
  expect(third.isDone).toBe(true);
});

test.each([
  { name: "missing", state: null },
  { name: "pending", state: { kind: "pending" } },
  { name: "running", state: { kind: "running", startedAt: 1, request: "private request" } },
  { name: "cancelled", state: { kind: "cancelled" } },
  { name: "failed", state: { kind: "failed", finishedAt: 1, call: null, error: "private error" } },
  {
    name: "rejected",
    state: {
      kind: "completed",
      finishedAt: 1,
      call: { startedAt: 1, request: "private request", response: "{}", usage: null },
      result: {
        kind: "initial",
        title: "private rejected title",
        decision: { kind: "rejected", reason: "private rejection reason" },
      },
    },
  },
] satisfies {
  name: string;
  state: Extract<Doc<"agentsApiRequestChecks">, { kind: "initial" }>["state"] | null;
}[])(
  "$name initial checks hide the task and hostname while preserving owner access",
  async ({ state }) => {
    const t = await setup();
    const previous = await t.managedReview("visible.test");
    vi.advanceTimersByTime(1);
    const hidden = await t.managedReview("hidden-only.test");
    await t.backend.run(async (ctx) => {
      if (state === null) await ctx.db.delete(hidden.checkId);
      else await ctx.db.patch(hidden.checkId, { state });
      const chat = await ctx.db.get(hidden.chatId);
      if (!chat) throw new Error("Missing chat");
      await syncChatSite(ctx, chat);
      await ctx.db.patch(hidden.sessionId, {
        walkthrough: { summary: "private walkthrough", sections: [] },
      });
    });
    for (const reader of [t.backend, t.other, t.member]) {
      const first = await reader.query(api.scout.activity.list, {
        scope: "public",
        site: null,
        paginationOpts: { cursor: null, numItems: 1 },
      });
      expect(first.page.map((review) => review.threadId)).toEqual([previous.sessionId]);
      expect(first.isDone).toBe(true);
      expect(JSON.stringify(first)).not.toMatch(/hidden-only|private walkthrough|private request/);
    }
    for (const reader of [t.backend, t.other]) {
      expect(await reader.query(api.scout.activity.get, { threadId: hidden.sessionId })).toBeNull();
      expect(
        await reader.query(api.scout.activity.messages, {
          threadId: hidden.sessionId,
          paginationOpts: { cursor: null, numItems: 3 },
        }),
      ).toMatchObject({ page: [], isDone: true });
      expect(
        (
          await reader.query(api.scout.activity.list, {
            scope: "public",
            site: "hidden-only.test",
            paginationOpts: { cursor: null, numItems: 3 },
          })
        ).page,
      ).toEqual([]);
    }
    const mine = await t.member.query(api.scout.activity.list, {
      scope: "mine",
      site: "hidden-only.test",
      paginationOpts: { cursor: null, numItems: 3 },
    });
    expect(mine.page.map((review) => review.threadId)).toEqual([hidden.sessionId]);
    expect(
      await t.member.query(api.scout.activity.get, { threadId: hidden.sessionId }),
    ).not.toBeNull();
  },
);

test("indexed pages skip a long run of hidden reviews without consuming the public cursor", async () => {
  const t = await setup();
  const oldest = await t.managedReview("oldest.test");
  for (let i = 0; i < 60; i++) {
    const hidden = await t.managedReview("hidden-only.test");
    await t.backend.run(async (ctx) => {
      await ctx.db.patch(hidden.checkId, { state: { kind: "pending" } });
      const chat = await ctx.db.get(hidden.chatId);
      if (!chat) throw new Error("Missing chat");
      await syncChatSite(ctx, chat);
    });
  }
  const list = (cursor: string | null) =>
    t.backend.query(api.scout.activity.list, {
      scope: "public",
      site: null,
      paginationOpts: {
        cursor,
        numItems: 10_000,
        maximumRowsRead: 10_000,
        maximumBytesRead: 10_000_000,
      },
    });
  const first = await list(null);
  expect(first.page.map((review) => review.threadId)).toEqual([oldest.sessionId]);
  expect(first.isDone).toBe(true);
  expect(JSON.stringify(first)).not.toContain("hidden-only.test");
});

test("native page bounds preserve end cursors, split metadata, and stricter caller budgets", async () => {
  const t = await setup();
  const reviews = [];
  for (let i = 0; i < 50; i++) reviews.unshift(await t.managedReview("example.test"));
  const args = { scope: "public", site: null } as const;
  const first = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: null, numItems: 1000 },
  });
  expect(first.page).toHaveLength(24);
  expect(first.pageStatus).toBe("SplitRequired");
  const second = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: first.continueCursor, numItems: 24 },
  });
  const third = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: second.continueCursor, numItems: 24 },
  });
  expect([...first.page, ...second.page, ...third.page].map((review) => review.threadId)).toEqual(
    reviews.map((review) => review.sessionId),
  );
  const bounded = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: null, endCursor: third.continueCursor, numItems: 1, id: 42 },
  });
  expect(bounded.page.map((review) => review.threadId)).toEqual(
    first.page.map((review) => review.threadId),
  );
  expect(bounded.pageStatus).toBe("SplitRequired");
  const narrow = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: null, numItems: 20, maximumRowsRead: 2 },
  });
  expect(narrow.page).toHaveLength(2);
  expect(narrow.splitCursor).toEqual(expect.any(String));
  const byteLimited = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: { cursor: null, numItems: 20, maximumBytesRead: 1 },
  });
  expect(byteLimited.page).toHaveLength(1);
  expect(byteLimited.pageStatus).toBe("SplitRequired");
  const split = await t.backend.query(api.scout.activity.list, {
    ...args,
    paginationOpts: {
      cursor: null,
      numItems: 20,
      ...omitNullish({ endCursor: narrow.splitCursor }),
    },
  });
  expect(split.page.map((review) => review.threadId)).toEqual([reviews[0].sessionId]);
});

test("unassigned reviews and private tasks remain accessible only to their owner in mine", async () => {
  const t = await setup();
  const own = await t.managedReview(null);
  const other = await t.managedReview("private-other.test");
  await t.backend.run(async (ctx) => {
    await ctx.db.patch(own.chatId, { visibility: "private" });
    await ctx.db.patch(own.checkId, { state: { kind: "pending" } });
    await ctx.db.patch(other.chatId, { visibility: "private", userId: t.otherId });
    await ctx.db.patch(other.sessionId, { userId: t.otherId });
    for (const id of [own.chatId, other.chatId]) {
      const chat = await ctx.db.get(id);
      if (!chat) throw new Error("Missing chat");
      await syncChatSite(ctx, chat);
    }
  });
  const mine = await t.member.query(api.scout.activity.list, {
    scope: "mine",
    site: null,
    paginationOpts: { cursor: null, numItems: 24 },
  });
  expect(mine.page).toMatchObject([
    { threadId: own.sessionId, primarySite: null, visibility: "private", walkthrough: null },
  ]);
  expect(JSON.stringify(mine)).not.toContain("private-other.test");
  const publicFeed = await t.backend.query(api.scout.activity.list, {
    scope: "public",
    site: null,
    paginationOpts: { cursor: null, numItems: 24 },
  });
  expect(publicFeed.page).toEqual([]);
  expect(JSON.stringify(publicFeed)).not.toContain("private-other.test");
});

test("tasks return the stored walkthrough summary and all check results without inventing checks for older reports", async () => {
  const t = await setup();
  const reviewed = await t.managedReview("example.test");
  const walkthrough = {
    summary: "Signup succeeded, but the settings page failed to save.",
    checks: [
      {
        label: "Signup",
        result: "passed",
        explanation: "Created an account and opened the welcome page.",
      },
      {
        label: "Save settings",
        result: "failed",
        explanation: "The save button returned a server error.",
      },
      { label: "Billing", result: "untested", explanation: "Billing was outside this review." },
    ],
    sections: [{ heading: "Signup", explanation: "Detailed walkthrough section", captureIds: [] }],
  } satisfies NonNullable<Doc<"agentsApiSessions">["walkthrough"]>;
  await t.backend.run((ctx) => ctx.db.patch(reviewed.sessionId, { walkthrough }));
  const args = {
    scope: "public",
    site: null,
    paginationOpts: { cursor: null, numItems: 3 },
  } as const;
  const feed = await t.backend.query(api.scout.activity.list, args);
  expect(feed.page[0].walkthrough).toEqual({
    summary: walkthrough.summary,
    checks: walkthrough.checks,
  });
  expect(JSON.stringify(feed)).not.toMatch(
    /private metadata|private initial request|Detailed walkthrough section/,
  );
  await t.backend.run((ctx) =>
    ctx.db.patch(reviewed.sessionId, {
      walkthrough: { summary: "Existing report without structured checks", sections: [] },
    }),
  );
  const old = await t.backend.query(api.scout.activity.list, args);
  expect(old.page[0].walkthrough).toEqual({ summary: "Existing report without structured checks" });
  await t.backend.run((ctx) => ctx.db.patch(reviewed.sessionId, { walkthrough: undefined }));
  const pending = await t.backend.query(api.scout.activity.list, args);
  expect(pending.page[0].walkthrough).toBeNull();
});

test("review site assignment preserves the subject across navigation and owner corrections", async () => {
  const t = await setup();
  const sessionId = await t.review();
  const identify = (site: string) =>
    t.backend.mutation(internal.scout.reviewSites.identify, { sessionId, site });
  expect(await identify(" SAMEBASE.COM ")).toEqual({ primarySite: "samebase.com" });
  expect(await identify("github.com")).toEqual({ primarySite: "samebase.com" });
  await t.backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    browser: {
      providerSessionId: "browser",
      cdpUrl: "wss://browser",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
      liveViewUrl: null,
      currentUrl: "https://dash.cloudflare.com",
    },
  });
  expect(await t.backend.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
    primarySite: "samebase.com",
  });
  await t.member.mutation(api.scout.reviewSites.set, {
    threadId: sessionId,
    site: " WWW.SAMEBASE.COM ",
  });
  expect(await identify("samebase.com")).toEqual({ primarySite: "www.samebase.com" });
  await expect(
    t.other.mutation(api.scout.reviewSites.set, { threadId: sessionId, site: "evil.test" }),
  ).rejects.toThrow("Review not found");
  await expect(
    t.backend.mutation(api.scout.reviewSites.set, { threadId: sessionId, site: "evil.test" }),
  ).rejects.toThrow("Not authorized");
  for (const site of [
    "",
    "https://samebase.com/apps",
    "samebase.com:443",
    "samebase.com/a",
    "a..com",
  ]) {
    await expect(
      t.member.mutation(api.scout.reviewSites.set, { threadId: sessionId, site }),
    ).rejects.toThrow();
    await expect(identify(site)).rejects.toThrow();
  }
  const game = await t.chat({ kind: "play", step: null }, "public");
  await expect(
    t.member.mutation(api.scout.reviewSites.set, { threadId: game.threadId, site: "game.test" }),
  ).rejects.toThrow("Review not found");
  await t.backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "stopped" },
  });
  await expect(identify("other.test")).rejects.toThrow("no longer running");
});

test.each([
  { kind: "running" },
  { kind: "failed", error: "Provider returned 404" },
  { kind: "stopped" },
] satisfies Doc<"agentsApiSessions">["state"][])(
  "keeps the original request visible in a $kind session until provider messages arrive",
  async (state) => {
    const t = await setup();
    const sessionId = await t.review();
    await t.backend.mutation(internal.tasks.sessions.update, { sessionId, state });
    const args = {
      threadId: sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    };
    expect((await t.backend.query(api.scout.activity.messages, args)).page).toEqual([
      {
        kind: "message",
        id: expect.any(String),
        role: "user",
        text: "Try this product's onboarding.",
      },
    ]);

    await t.backend.mutation(internal.tasks.sessions.saveItems, {
      sessionId,
      items: [
        {
          providerItemId: "original-request",
          kind: "user",
          text: "Try this product's onboarding.",
          details: "",
        },
      ],
    });
    const synced = await t.backend.query(api.scout.activity.messages, args);
    expect(synced.page).toHaveLength(1);
    expect(synced.page[0]).toMatchObject({
      kind: "message",
      text: "Try this product's onboarding.",
    });
    const older = await t.backend.query(api.scout.activity.messages, {
      ...args,
      paginationOpts: { numItems: 10, cursor: synced.continueCursor },
    });
    expect(older.page).toEqual([]);
  },
);

test("managed Reviews share the feed and expose only conversation text and watch-only browser access", async () => {
  const t = await setup();
  const oldReview = await t.chat({ kind: "review" }, "public");
  vi.advanceTimersByTime(1);
  const sessionId = await t.review();
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
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
    { kind: "message", id: expect.any(String), role: "assistant", text: "I opened the site." },
  ]);
  let earlier = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { numItems: 1, cursor: messages.continueCursor },
  });
  while (!earlier.isDone && earlier.page.length === 0) {
    earlier = await t.backend.query(api.scout.activity.messages, {
      threadId: sessionId,
      paginationOpts: { numItems: 1, cursor: earlier.continueCursor },
    });
  }
  expect(earlier.page).toEqual([
    { kind: "message", id: expect.any(String), role: "user", text: "Try the site" },
  ]);
  const feed = await t.backend.query(api.scout.activity.list, {
    site: null,
    scope: "public",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(feed.page.map((item) => item.threadId)).toEqual([sessionId]);
  const next = await t.backend.query(api.scout.activity.list, {
    site: null,
    scope: "public",
    paginationOpts: { numItems: 1, cursor: feed.continueCursor },
  });
  expect(next.page.map((item) => item.threadId)).toEqual([oldReview.threadId]);
  await t.backend.mutation(internal.tasks.browsers.open, {
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
    runtime: { kind: "task", sessionId },
  });
  expect(JSON.stringify(view)).not.toMatch(/private|cdp|inbox|profile/);
  const browser = view?.sessions[0];
  if (browser?.engine !== "agents_api") throw new Error("Expected a managed browser");
  expect(
    await t.backend.query(api.scout.activity.liveView, { sessionId: browser.sessionId }),
  ).toEqual({ url: "https://liveview.firecrawl.dev/watch-only" });
  expect(
    await t.backend.query(internal.tasks.browsers.replayData, { sessionId: browser.sessionId }),
  ).not.toBeNull();
  await expect(t.other.query(api.tasks.sessions.controls, { sessionId })).rejects.toThrow(
    "Session not found",
  );
  await expect(
    t.other.mutation(api.tasks.sessions.send, { sessionId, message: "Take over" }),
  ).rejects.toThrow("Session not found");
  await expect(
    t.other.mutation(api.tasks.sessions.resume, { sessionId, callId: "call", turnId: "turn" }),
  ).rejects.toThrow("Session not found");
  await expect(t.other.mutation(api.tasks.sessions.stop, { sessionId })).rejects.toThrow(
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
    await t.backend.query(internal.tasks.browsers.replayData, { sessionId: browser.sessionId }),
  ).toBeNull();
  expect(
    await t.backend.query(api.scout.activity.messages, {
      threadId: sessionId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).toMatchObject({ page: [] });
  expect(
    await t.member.query(internal.tasks.browsers.replayData, { sessionId: browser.sessionId }),
  ).not.toBeNull();
});

test("Review owners can resume handoffs, stop, and send follow-ups while Lab remains private", async () => {
  const t = await setup();
  const sessionId = await t.review("private");
  await t.backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "running" },
    providerId: "provider",
  });
  await t.backend.mutation(internal.tasks.browsers.open, {
    sessionId,
    browser: {
      providerSessionId: "provider-browser",
      cdpUrl: "wss://private-cdp",
      liveViewUrl: "https://liveview.firecrawl.dev/watch-only",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
      currentUrl: null,
    },
  });
  await t.backend.mutation(internal.tasks.sessions.enterHandoff, {
    sessionId,
    message: "Complete verification",
    callId: "handoff",
    turnId: "turn",
  });
  const controls = await t.member.query(api.tasks.sessions.controls, { sessionId });
  expect(controls).toMatchObject({
    state: { kind: "waiting" },
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/private-control",
  });
  const delivery = await t.backend.query(internal.tasks.sessions.handoffNotification, {
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
  await t.backend.action(internal.tasks.handoff.notify, { sessionId, callId: "handoff" });
  expect(sendMail).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining(`http://localhost:5173/handoff/${sessionId}#access=hh1_`),
    }),
  );
  expect(sendMail).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining('"to":["player@example.test"]'),
    }),
  );
  await t.member.mutation(api.tasks.sessions.resume, {
    sessionId,
    callId: "handoff",
    turnId: "turn",
  });
  expect(await t.member.query(api.tasks.sessions.controls, { sessionId })).toMatchObject({
    state: { kind: "checking" },
    canSend: false,
    canStop: true,
    interactiveLiveViewUrl: null,
  });
  expect(
    await t.backend.query(internal.tasks.sessions.handoffNotification, {
      sessionId,
      callId: "handoff",
    }),
  ).toBeNull();
  await t.backend.action(internal.tasks.handoff.notify, { sessionId, callId: "handoff" });
  expect(sendMail).toHaveBeenCalledTimes(1);
  await t.member.mutation(api.tasks.sessions.stop, { sessionId });
  expect(await t.member.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
    status: "stopping",
  });
  await t.backend.mutation(internal.tasks.sessions.update, { sessionId, active: false });
  await t.backend.mutation(internal.tasks.browsers.close, {
    providerSessionId: "provider-browser",
    providerDurationMs: null,
    creditsBilled: null,
  });
  await t.member.mutation(api.tasks.sessions.send, {
    sessionId,
    message: "Check another page",
  });
  expect(await t.member.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
    status: "running",
  });
  await expect(
    t.member.query(api.tasks.sessions.listItems, {
      sessionId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).rejects.toThrow("Not authorized");
});

test("paginates reviews by site without leaking private conversations or including games", async () => {
  const t = await setup();
  const first = await t.chat({ kind: "review" }, "public");
  vi.advanceTimersByTime(1);
  const second = await t.chat({ kind: "review" }, "public", t.otherId);
  const ownPrivate = await t.chat({ kind: "review" }, "private");
  const otherPrivate = await t.chat({ kind: "review" }, "private", t.otherId);
  const different = await t.chat({ kind: "review" }, "public");
  await t.chat({ kind: "general" }, "public", t.adminId);
  await t.chat({ kind: "play", step: null }, "public");
  await t.backend.run(async (ctx) => {
    for (const chat of [first, second, ownPrivate, otherPrivate])
      await ctx.db.patch(chat.chatId, { primarySite: "samebase.com" });
    await ctx.db.patch(different.chatId, { primarySite: "chessmerge.com" });
  });
  const all = await t.backend.query(api.scout.activity.list, {
    site: null,
    scope: "public",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(all.page.map((row) => row.threadId)).toEqual([
    different.threadId,
    second.threadId,
    first.threadId,
  ]);
  const list = (cursor: string | null) =>
    t.backend.query(api.scout.activity.list, {
      site: " SAMEBASE.COM ",
      scope: "public",
      paginationOpts: { cursor, numItems: 1 },
    });
  const page = await list(null);
  expect(page.page.map((row) => row.threadId)).toEqual([second.threadId]);
  expect((await list(page.continueCursor)).page.map((row) => row.threadId)).toEqual([
    first.threadId,
  ]);
  expect(page.page[0]?.primarySite).toBe("samebase.com");
  const mine = await t.member.query(api.scout.activity.list, {
    site: "samebase.com",
    scope: "mine",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(mine.page.map((row) => row.threadId)).toEqual([ownPrivate.threadId, first.threadId]);
  await expect(
    t.backend.query(api.scout.activity.list, {
      site: "samebase.com",
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
    canControl: false,
  });
});

test("Review starts an Agents API session for a member without Lab permission", async () => {
  const t = await setup();
  const selection = { model: "openai/gpt-5.6-luna", reasoningEffort: "high" } as const;
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { defaultScoutModelSelection: selection }));
  const { threadId } = await t.member.mutation(api.scout.chats.startProductChat, {
    selection: { engine: "agents_api", model: "gpt-5.6-luna" },
    product: { kind: "review" },
    scoutId: t.scoutId,
    prompt: "Try this product's onboarding.",
    visibility: "private",
  });
  expect(await t.backend.run((ctx) => ctx.db.query("scoutTurns").first())).toBeNull();
  const sessionId = await t.backend.run(async (ctx) =>
    ctx.db.normalizeId("agentsApiSessions", threadId),
  );
  if (!sessionId) throw new Error("Expected a managed session");
  expect(await t.backend.query(internal.tasks.sessions.runtime, { sessionId })).toMatchObject({
    purpose: { kind: "review" },
    session: { model: "gpt-5.6-luna", active: true },
  });
  await expect(t.member.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  expect(await t.member.query(api.tasks.sessions.controls, { sessionId })).toMatchObject({
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
      selection: { engine: "agents_api", model: "gpt-5.6-luna" },
      product: { kind: "play" },
      scoutId: t.scoutId,
      prompt: "Play with me",
      visibility: "private",
    }),
  ).rejects.toThrow("already working");
  await t.backend.run((ctx) => ctx.db.patch(t.memberId, { isApproved: false }));
  await expect(t.backend.query(internal.tasks.sessions.runtime, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
  await expect(
    t.member.mutation(api.scout.chats.startProductChat, {
      selection: { engine: "agents_api", model: "gpt-5.6-luna" },
      product: { kind: "review" },
      scoutId: t.scoutId,
      prompt: "Another review",
      visibility: "private",
    }),
  ).rejects.toThrow("Not authorized");
});

test.each(["approved", "rejected"] as const)(
  "uses only the %s initial decision for public admission, even when Resume disagrees",
  async (initialDecision) => {
    const t = await setup();
    const sessionId = await t.review();
    await t.backend.mutation(internal.tasks.sessions.saveItems, {
      sessionId,
      items: [
        {
          providerItemId: "reply",
          kind: "assistant",
          text: "Testing signup",
          details: "private metadata",
        },
      ],
    });
    await t.backend.run(async (ctx) => {
      const initial = await ctx.db
        .query("agentsApiRequestChecks")
        .withIndex("by_session_id_and_kind", (q) =>
          q.eq("sessionId", sessionId).eq("kind", "initial"),
        )
        .unique();
      if (!initial || initial.state.kind !== "completed")
        throw new Error("Expected an initial decision");
      if (initialDecision === "rejected")
        await ctx.db.patch(initial._id, {
          state: {
            ...initial.state,
            result: {
              kind: "initial",
              title: "Test product onboarding",
              decision: { kind: "rejected", reason: "Unauthorized task" },
            },
          },
        });
      const chat = await ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (q) => q.eq("threadId", sessionId))
        .unique();
      if (!chat) throw new Error("Missing chat");
      await syncChatSite(ctx, chat);
      await ctx.db.insert("agentsApiRequestChecks", {
        kind: "resume",
        sessionId,
        prompt: initial.prompt,
        model: initial.model,
        handoff: { callId: "call", turnId: "turn", message: "Private verification reason" },
        providerSessionId: "browser",
        evidence: { capturedAt: Date.now(), pages: [] },
        state: {
          kind: "completed",
          finishedAt: Date.now(),
          call: {
            startedAt: Date.now(),
            request: "private request",
            response: "private response",
            usage: null,
          },
          result: {
            kind: "resume",
            decision:
              initialDecision === "approved"
                ? { kind: "rejected", reason: "Private Resume rejection" }
                : { kind: "approved" },
          },
        },
      });
      await ctx.db.patch(sessionId, {
        state: {
          kind: "waiting",
          callId: "call",
          turnId: "turn",
          message: "Private verification reason",
        },
      });
    });
    const feed = await t.backend.query(api.scout.activity.list, {
      scope: "public",
      site: null,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const activity = await t.backend.query(api.scout.activity.get, { threadId: sessionId });
    const messages = await t.backend.query(api.scout.activity.messages, {
      threadId: sessionId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    if (initialDecision === "approved") {
      expect(feed.page).toMatchObject([{ threadId: sessionId, title: "Test product onboarding" }]);
      expect(activity).toMatchObject({ title: "Test product onboarding", status: "waiting" });
      expect(messages.page).toMatchObject([{ text: "Testing signup" }]);
      expect(JSON.stringify({ feed, activity, messages })).not.toMatch(/Private|private/);
    } else {
      expect(feed.page).toEqual([]);
      expect(activity).toBeNull();
      expect(messages.page).toEqual([]);
    }
  },
);

test("public messages expose useful tools and conversation text without system messages or reasoning", async () => {
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
              args: { code: "return await browserState(page);" },
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
              output: { type: "json", value: { success: true, output: "Opened the page" } },
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
  expect(
    result.page.filter((item) => item.kind === "message").map(({ role, text }) => ({ role, text })),
  ).toEqual([
    { role: "assistant", text: "I'll join now." },
    { role: "user", text: "Join my game" },
  ]);
  expect(result.page[0]).toMatchObject({
    kind: "tool",
    tool: { name: "browser_execute", state: "completed" },
  });
  expect(JSON.stringify(result)).toContain("return await browserState(page)");
  expect(JSON.stringify(result)).not.toMatch(/private|reasoning/);
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

test("Agents tools pair by session and call ID across pages, including actual error results", async () => {
  const t = await setup();
  const sessionId = await t.review();
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "call-item",
        kind: "function_call",
        text: "browser_execute",
        complete: true,
        details: JSON.stringify({
          type: "function_call",
          name: "browser_execute",
          call_id: "call-1",
          status: "completed",
          arguments: {
            code: "await page.getByRole('button', { name: 'Save' }).click();",
            captureNote: "Saved project",
          },
        }),
      },
      ...Array.from({ length: 60 }, (_, index) => ({
        providerItemId: `reasoning-${index}`,
        kind: "reasoning",
        text: "hidden reasoning",
        details: "{}",
      })),
      {
        providerItemId: "output-item",
        kind: "function_call_output",
        text: "Tool result",
        complete: true,
        details: JSON.stringify({
          type: "function_call_output",
          call_id: "call-1",
          output: "Not the persisted result",
          status: "completed",
        }),
      },
    ],
  });
  await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "call-1",
      result: {
        kind: "success",
        output: JSON.stringify({
          success: false,
          error: "Save button is disabled",
          output: "No project was saved",
          currentPage: "button Save [disabled]",
        }),
      },
    }),
  );
  const first = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { cursor: null, numItems: 50 },
  });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  const second = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { cursor: first.continueCursor, numItems: 50 },
  });
  expect(second.page).toHaveLength(1);
  expect(second.page[0]).toMatchObject({
    kind: "tool",
    tool: {
      name: "browser_execute",
      state: "failed",
      error: "Save button is disabled",
      preview: "Saved project",
      input: expect.stringContaining("getByRole"),
      output: expect.stringContaining("No project was saved"),
    },
  });
  expect(JSON.stringify(second)).not.toMatch(
    /hidden reasoning|Not the persisted result|providerItemId/,
  );
  const admin = t.backend.withIdentity({ subject: `${t.adminId}|session` });
  const adminFirst = await admin.query(api.tasks.sessions.listItems, {
    sessionId,
    paginationOpts: { cursor: null, numItems: 50 },
  });
  expect(adminFirst.page.some((item) => item.kind === "function_call_output")).toBe(false);
  expect(adminFirst.page.every((item) => item.tool === null)).toBe(true);
  const adminSecond = await admin.query(api.tasks.sessions.listItems, {
    sessionId,
    paginationOpts: { cursor: adminFirst.continueCursor, numItems: 50 },
  });
  expect(adminSecond.page.find((item) => item.kind === "function_call")?.tool).toMatchObject({
    state: "failed",
    error: "Save button is disabled",
  });
  await expect(
    t.member.query(api.tasks.sessions.listItems, {
      sessionId,
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  ).rejects.toThrow("Not authorized");
});

test("call emission completion does not mean tool success and stopped sessions interrupt unmatched calls", async () => {
  const t = await setup();
  const sessionId = await t.review("private");
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "call-item",
        kind: "function_call",
        text: "bash",
        complete: true,
        details: JSON.stringify({
          type: "function_call",
          name: "bash",
          call_id: "call",
          status: "completed",
          arguments: { command: "ls /workspace" },
        }),
      },
    ],
  });
  const args = { threadId: sessionId, paginationOpts: { cursor: null, numItems: 10 } };
  expect((await t.member.query(api.scout.activity.messages, args)).page[0]).toMatchObject({
    kind: "tool",
    tool: { state: "running", preview: "ls /workspace" },
  });
  expect((await t.backend.query(api.scout.activity.messages, args)).page).toEqual([]);
  expect((await t.other.query(api.scout.activity.messages, args)).page).toEqual([]);
  await t.backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "stopped" },
  });
  expect((await t.member.query(api.scout.activity.messages, args)).page[0]).toMatchObject({
    kind: "tool",
    tool: { state: "interrupted" },
  });
  await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "call",
      result: { kind: "error", error: "Workspace file not found: /workspace/report.csv" },
    }),
  );
  expect((await t.member.query(api.scout.activity.messages, args)).page[0]).toMatchObject({
    kind: "tool",
    tool: { state: "failed", error: "Workspace file not found: /workspace/report.csv" },
  });
});

test("Convex tools pair later results by call ID across pagination and do not confuse turn-local IDs", async () => {
  const t = await setup();
  const { threadId } = await t.chat({ kind: "play", step: null }, "public");
  await t.backend.mutation(components.agent.messages.addMessages, {
    threadId,
    messages: [
      { message: { role: "user", content: "Search and inspect the workspace" } },
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "search",
              toolName: "web_search",
              args: { query: "SQLite documentation" },
            },
            {
              type: "tool-call",
              toolCallId: "shell",
              toolName: "bash",
              args: { command: "cat /workspace/report.csv" },
            },
          ],
        },
      },
      ...Array.from(
        { length: 70 },
        () =>
          ({
            message: {
              role: "assistant",
              content: [{ type: "reasoning", text: "private reasoning" }],
            },
          }) satisfies Parameters<
            typeof t.backend.mutation<typeof components.agent.messages.addMessages>
          >[1]["messages"][number],
      ),
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "shell",
              toolName: "bash",
              output: {
                type: "json",
                value: { stdout: "", stderr: "report.csv: no such file", exitCode: 1 },
              },
            },
            {
              type: "tool-result",
              toolCallId: "search",
              toolName: "web_search",
              output: {
                type: "json",
                value: {
                  results: [
                    {
                      title: "SQLite docs",
                      url: "https://sqlite.org/docs.html",
                      description: "Official documentation",
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      { message: { role: "user", content: "Later turn" } },
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "search",
              toolName: "web_search",
              output: { type: "error-text", value: "Wrong turn result" },
            },
          ],
        },
      },
    ],
  });
  const first = await t.backend.query(api.scout.activity.messages, {
    threadId,
    paginationOpts: { cursor: null, numItems: 50 },
  });
  const second = await t.backend.query(api.scout.activity.messages, {
    threadId,
    paginationOpts: { cursor: first.continueCursor, numItems: 50 },
  });
  const tools = second.page.filter((item) => item.kind === "tool").map((item) => item.tool);
  expect(tools).toHaveLength(2);
  expect(tools[0]).toMatchObject({
    name: "bash",
    state: "failed",
    error: "Process exited with code 1",
    input: expect.stringContaining("cat /workspace/report.csv"),
    output: expect.stringContaining("no such file"),
  });
  expect(tools[1]).toMatchObject({
    name: "web_search",
    state: "completed",
    preview: "SQLite documentation",
    output: expect.stringContaining("Official documentation"),
    links: [{ label: "SQLite docs", url: "https://sqlite.org/docs.html" }],
  });
  expect(JSON.stringify(second)).not.toMatch(/Wrong turn result|private reasoning/);
});

test("screenshot references must be ready and belong to the current task", async () => {
  const t = await setup();
  const sessionId = await t.review();
  const otherSession = await t.managedReview("other.test");
  const captureId = await t.backend.run(async (ctx) => {
    const browserId = await ctx.db.insert("agentsApiBrowserSessions", {
      agentsSessionId: sessionId,
      sequence: 0,
      providerSessionId: "browser",
      viewport: { width: 100, height: 100 },
      lifecycle: { kind: "active", openedAtMs: 0 },
      nextOperationSequence: 1,
    });
    const operationId = await ctx.db.insert("agentsApiBrowserOperations", {
      sessionId: browserId,
      sequence: 0,
      toolCallId: "capture",
      action: { kind: "execute", code: "return browserState(page)" },
      state: { kind: "prepared", preparedAtMs: 0 },
      clickCapture: null,
    });
    return ctx.db.insert("agentsApiScreenshots", {
      sessionId,
      operationId,
      browserSequence: 0,
      operationSequence: 0,
      note: "Saved",
      state: {
        kind: "ready",
        key: "private-storage-key",
        metadata: {
          tabId: "tab",
          url: "https://example.test/project",
          title: "Project",
          startedAtMs: 0,
          completedAtMs: 1,
          width: 100,
          height: 100,
          viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0 },
        },
      },
    });
  });
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "capture",
        kind: "function_call",
        text: "browser_execute",
        details: JSON.stringify({
          type: "function_call",
          name: "browser_execute",
          call_id: "capture",
          status: "completed",
          arguments: { code: "return await browserState(page);" },
        }),
      },
    ],
  });
  await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "capture",
      result: {
        kind: "success",
        output: JSON.stringify({ success: true, capture: { kind: "ready", captureId } }),
      },
    }),
  );
  const args = { threadId: sessionId, paginationOpts: { cursor: null, numItems: 10 } };
  expect((await t.member.query(api.scout.activity.messages, args)).page[0]).toMatchObject({
    kind: "tool",
    tool: { captures: [captureId] },
  });
  await t.backend.run((ctx) => ctx.db.patch(captureId, { sessionId: otherSession.sessionId }));
  expect((await t.member.query(api.scout.activity.messages, args)).page[0]).toMatchObject({
    kind: "tool",
    tool: { captures: [] },
  });
});

test("hosted MCP, shell and web search tools expose their own results without provider internals", async () => {
  const t = await setup();
  const sessionId = await t.review();
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "mcp",
        kind: "mcp_call",
        text: "MCP tool",
        details: JSON.stringify({
          type: "mcp_call",
          name: "web_map",
          arguments: { url: "https://example.test" },
          output: { links: [{ title: "Docs", url: "https://example.test/docs" }] },
          error: null,
          status: "completed",
          server_label: "private provider config",
        }),
      },
      {
        providerItemId: "shell",
        kind: "command_execution",
        text: "Shell",
        details: JSON.stringify({
          type: "command_execution",
          command: "cat missing.csv",
          cwd: "/workspace",
          duration_ms: 20,
          exit_code: 1,
          output: "No such file: missing.csv",
          status: "completed",
        }),
      },
      {
        providerItemId: "web",
        kind: "web_search_call",
        text: "Web search",
        details: JSON.stringify({
          type: "web_search_call",
          action: { type: "search", query: "Product docs", queries: null },
          status: "completed",
        }),
      },
    ],
  });
  const result = await t.backend.query(api.scout.activity.messages, {
    threadId: sessionId,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(result.page).toMatchObject([
    {
      kind: "tool",
      tool: { name: "web_search_call", state: "completed", preview: "Product docs", output: null },
    },
    {
      kind: "tool",
      tool: {
        name: "command_execution",
        state: "failed",
        preview: "cat missing.csv",
        output: expect.stringContaining("No such file"),
        error: "Process exited with code 1",
      },
    },
    {
      kind: "tool",
      tool: {
        name: "web_map",
        state: "completed",
        links: [{ label: "Docs", url: "https://example.test/docs" }],
      },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("private provider config");
});

test("malformed provider tool data fails closed after chat authorization", async () => {
  const t = await setup();
  const sessionId = await t.review("private");
  await t.backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "bad",
        kind: "function_call",
        text: "private",
        details: JSON.stringify({
          type: "function_call",
          name: "bash",
          arguments: { password: "private value" },
        }),
      },
    ],
  });
  const args = { threadId: sessionId, paginationOpts: { cursor: null, numItems: 10 } };
  expect((await t.other.query(api.scout.activity.messages, args)).page).toEqual([]);
  await expect(t.member.query(api.scout.activity.messages, args)).rejects.toThrow(
    "Stored tool activity is invalid",
  );
});
