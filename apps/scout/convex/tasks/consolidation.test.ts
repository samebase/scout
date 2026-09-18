/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { scoutReservation } from "../scout/availability";
import type { chatVisibilityValidator, productKindValidator } from "../scout/chatModel";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import type { taskEngine } from "./model";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const engines: Array<typeof taskEngine.type> = ["agents_api", "convex_agent"];
const products: Array<typeof productKindValidator.type> = ["play", "review"];
const paginationOpts = { numItems: 20, cursor: null };
const prompt = "Check https://example.test and report what works";
const browser = {
  providerSessionId: "consolidation-browser",
  cdpUrl: "wss://example.test/private-cdp",
  liveViewUrl: "https://example.test/watch",
  interactiveLiveViewUrl: "https://example.test/control",
  currentUrl: "https://example.test/verify",
};
const handoff = {
  callId: "handoff-call",
  turnId: "handoff-turn",
  message: "Complete verification",
};
const network = vi.fn<typeof fetch>(async () => {
  throw new Error("Consolidation tests must not execute network-backed workflows");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T09:00:00Z"));
  network.mockClear();
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    // Workflow scheduling is real, but these tests never advance its timers.
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const inspectorId = await insertTestAccount(ctx, { email: "nicu@samebase.com" });
    const memberId = await insertTestAccount(ctx, { email: "member@example.test" });
    const strangerId = await insertTestAccount(ctx, { email: "stranger@example.test" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Consolidation Scout",
      websiteIdentity: { firstName: "Consolidation", lastName: "Scout" },
      slug: "consolidation-scout",
      status: "active",
      agentMail: { inboxId: "consolidation-inbox", address: "scout@example.test" },
      firecrawl: { profileName: "consolidation-profile" },
    });
    return { adminId, inspectorId, memberId, strangerId, scoutId };
  });
  const admin = backend.withIdentity({ subject: ids.adminId });
  const inspector = backend.withIdentity({ subject: ids.inspectorId });
  const member = backend.withIdentity({ subject: ids.memberId });
  const stranger = backend.withIdentity({ subject: ids.strangerId });
  const start = (engine: typeof taskEngine.type) =>
    admin.mutation(api.tasks.sessions.start, { scoutId: ids.scoutId, prompt, engine });
  const read = (sessionId: Id<"agentsApiSessions">) =>
    backend.query(internal.tasks.sessions.cleanupResources, { sessionId });
  const product = async (kind: typeof productKindValidator.type) => {
    const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
      product: { kind },
      scoutId: ids.scoutId,
      prompt,
      visibility: "private",
    });
    const chat = await backend.run((ctx) =>
      ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
        .unique(),
    );
    if (chat?.runtime?.kind !== "agents_api") throw new Error("Product must bind a shared task");
    expect(chat.runtime.sessionId).toBe(threadId);
    return chat.runtime.sessionId;
  };
  return { backend, admin, inspector, member, stranger, start, read, product, ...ids };
}

it.each(engines)(
  "persists an admin's %s selection with the common admission check",
  async (engine) => {
    const { backend, admin, start, read, adminId, scoutId } = await setup();
    const sessionId = await start(engine);
    expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
      engine,
      userId: adminId,
      scoutId,
      active: true,
      state: { kind: "starting" },
    });
    expect((await read(sessionId)).workflowId).toBeDefined();
    expect(await admin.query(api.tasks.sessions.get, { sessionId })).toMatchObject({
      engine,
      canControl: true,
    });
    expect((await admin.query(api.tasks.sessions.list, { paginationOpts })).page).toMatchObject([
      { _id: sessionId, engine },
    ]);
    const checks = await backend.run((ctx) =>
      ctx.db
        .query("agentsApiRequestChecks")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .take(10),
    );
    expect(checks).toMatchObject([{ kind: "initial", prompt, state: { kind: "pending" } }]);
    expect(checks).toHaveLength(1);
    await expect(start(engine === "agents_api" ? "convex_agent" : "agents_api")).rejects.toThrow(
      "already working",
    );
  },
);

it.each(engines)("denies member and anonymous access to the admin %s selector", async (engine) => {
  const { backend, member, scoutId } = await setup();
  for (const viewer of [member, backend]) {
    await expect(
      viewer.mutation(api.tasks.sessions.start, { scoutId, prompt, engine }),
    ).rejects.toThrow("Not authorized");
  }
  expect(await backend.run((ctx) => ctx.db.query("agentsApiSessions").take(1))).toEqual([]);
  expect(await backend.run((ctx) => ctx.db.query("agentsApiRequestChecks").take(1))).toEqual([]);
});

it.each(products)(
  "defaults member %s tasks to Agents API without creating a legacy turn",
  async (kind) => {
    const { backend, member, memberId, product, read } = await setup();
    const sessionId = await product(kind);
    expect(await read(sessionId)).toMatchObject({ engine: "agents_api", userId: memberId });
    expect(await member.query(api.tasks.sessions.controls, { sessionId })).toMatchObject({
      canStop: true,
    });
    expect(await member.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
      isOwner: true,
      canControl: true,
      purpose: { kind },
      runtime: { kind: "task", sessionId },
    });
    expect(await backend.run((ctx) => ctx.db.query("scoutTurns").take(1))).toEqual([]);
  },
);

it.each(products.flatMap((kind) => engines.map((engine) => ({ kind, engine }))))(
  "uses the member's $engine selection for $kind",
  async ({ kind, engine }) => {
    const { backend, member, scoutId } = await setup();
    const visibility: typeof chatVisibilityValidator.type = "private";
    const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
      product: { kind },
      scoutId,
      prompt,
      visibility,
      engine,
    });
    const [session] = await backend.run((ctx) => ctx.db.query("agentsApiSessions").take(1));
    expect(session).toMatchObject({ _id: threadId, engine });
    expect(await member.query(api.accounts.taskPreferences, {})).toEqual({
      lastScoutId: scoutId,
      lastTaskEngine: engine,
    });
    expect(await member.query(api.scout.activity.get, { threadId })).toMatchObject({
      canControl: true,
      runtime: { kind: "task", sessionId: threadId },
    });
  },
);

it.each(products)("denies %s creation after membership is revoked", async (kind) => {
  const { backend, member, memberId, scoutId } = await setup();
  await backend.run((ctx) => ctx.db.patch(memberId, { isApproved: false }));
  await expect(
    member.mutation(api.scout.chats.startProductChat, {
      product: { kind },
      scoutId,
      prompt,
      visibility: "private",
    }),
  ).rejects.toThrow("Not authorized");
  expect(await backend.run((ctx) => ctx.db.query("agentsApiSessions").take(1))).toEqual([]);
});

it.each(engines)(
  "allows %s admin inspection but reserves execution and browser control for the owner",
  async (engine) => {
    const { backend, admin, inspector, member, start } = await setup();
    const sessionId = await start(engine);
    await backend.mutation(internal.tasks.browsers.open, { sessionId, browser });
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    await backend.mutation(internal.tasks.sessions.enterHandoff, { sessionId, ...handoff });
    expect(await admin.query(api.tasks.sessions.controls, { sessionId })).toMatchObject({
      interactiveLiveViewUrl: browser.interactiveLiveViewUrl,
    });
    const inspected = await inspector.query(api.tasks.sessions.get, { sessionId });
    expect(inspected).toMatchObject({
      engine,
      canControl: false,
      browser: { interactiveLiveViewUrl: null, liveViewUrl: browser.liveViewUrl },
    });
    const browsers = await inspector.query(api.tasks.sessions.listBrowsers, { sessionId });
    expect(browsers).toMatchObject([
      { interactiveLiveViewUrl: null, liveViewUrl: browser.liveViewUrl },
    ]);
    expect(JSON.stringify({ inspected, browsers })).not.toContain(browser.cdpUrl);
    for (const viewer of [inspector, member, backend]) {
      await expect(viewer.query(api.tasks.sessions.controls, { sessionId })).rejects.toThrow();
      await expect(
        viewer.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" }),
      ).rejects.toThrow();
      await expect(
        viewer.mutation(api.tasks.sessions.resume, {
          sessionId,
          callId: handoff.callId,
          turnId: handoff.turnId,
        }),
      ).rejects.toThrow();
      await expect(viewer.mutation(api.tasks.sessions.stop, { sessionId })).rejects.toThrow();
    }
    for (const viewer of [member, backend]) {
      await expect(viewer.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow(
        "Not authorized",
      );
      await expect(
        viewer.query(api.tasks.sessions.listItems, { sessionId, paginationOpts }),
      ).rejects.toThrow("Not authorized");
    }
    await expect(admin.mutation(api.tasks.sessions.stop, { sessionId })).resolves.toBeNull();
  },
);

it.each(products)(
  "exposes a public %s only after approval and never grants a viewer controls",
  async (kind) => {
    const { backend, admin, member, stranger, product } = await setup();
    const sessionId = await product(kind);
    expect(await admin.query(api.tasks.sessions.get, { sessionId })).toMatchObject({
      canControl: false,
    });
    expect(await member.query(api.tasks.walkthrough.get, { sessionId })).not.toBeNull();
    expect(await stranger.query(api.tasks.walkthrough.get, { sessionId })).toBeNull();
    await member.mutation(api.scout.chats.setVisibility, {
      threadId: sessionId,
      visibility: "public",
    });
    expect(await backend.query(api.scout.activity.get, { threadId: sessionId })).toBeNull();
    expect(await backend.query(api.tasks.walkthrough.get, { sessionId })).toBeNull();
    const check = await backend.run((ctx) =>
      ctx.db
        .query("agentsApiRequestChecks")
        .withIndex("by_session_id_and_kind", (q) =>
          q.eq("sessionId", sessionId).eq("kind", "initial"),
        )
        .unique(),
    );
    if (!check) throw new Error("Missing initial admission check");
    await backend.mutation(internal.tasks.requestChecks.start, {
      checkId: check._id,
      request: prompt,
      startedAt: Date.now(),
      evidence: null,
    });
    await backend.mutation(internal.tasks.requestChecks.finish, {
      checkId: check._id,
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: prompt, response: "approved", usage: null },
        result: { kind: "initial", title: "Example task", decision: { kind: "approved" } },
      },
    });
    for (const viewer of [backend, stranger]) {
      expect(await viewer.query(api.scout.activity.get, { threadId: sessionId })).toMatchObject({
        isOwner: false,
        canControl: false,
      });
      expect(await viewer.query(api.tasks.walkthrough.get, { sessionId })).not.toBeNull();
      await expect(viewer.query(api.tasks.sessions.controls, { sessionId })).rejects.toThrow();
      await expect(viewer.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow();
      await expect(viewer.mutation(api.tasks.sessions.stop, { sessionId })).rejects.toThrow();
    }
    await member.mutation(api.scout.chats.setVisibility, {
      threadId: sessionId,
      visibility: "private",
    });
    expect(await backend.query(api.scout.activity.get, { threadId: sessionId })).toBeNull();
    expect(await backend.query(api.tasks.walkthrough.get, { sessionId })).toBeNull();
    expect(await admin.query(api.tasks.walkthrough.get, { sessionId })).not.toBeNull();
  },
);

it.each(engines)(
  "keeps %s reserved through Stop and rejects new claims until cleanup",
  async (engine) => {
    const { backend, admin, start, read, scoutId } = await setup();
    const sessionId = await start(engine);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    await backend.mutation(internal.tasks.browsers.open, { sessionId, browser });
    await backend.mutation(internal.tasks.sessions.enterHandoff, { sessionId, ...handoff });
    await admin.mutation(api.tasks.sessions.stop, { sessionId });
    const stopped = await read(sessionId);
    expect(stopped).toMatchObject({ engine, active: true, state: { kind: "stopped" } });
    expect(stopped.cleanupJobId).toBeDefined();
    await admin.mutation(api.tasks.sessions.stop, { sessionId });
    expect((await read(sessionId)).cleanupJobId).toBe(stopped.cleanupJobId);
    await expect(start(engine === "agents_api" ? "convex_agent" : "agents_api")).rejects.toThrow(
      "already working",
    );
    await backend.mutation(internal.tasks.sessions.update, { sessionId, state: { kind: "idle" } });
    expect((await read(sessionId)).state).toEqual({ kind: "stopped" });
    await expect(
      backend.mutation(internal.tasks.sessions.claimCall, { sessionId, callId: "late-write" }),
    ).rejects.toThrow("stopped");
    await backend.mutation(internal.tasks.browsers.close, {
      providerSessionId: browser.providerSessionId,
      providerDurationMs: 1000,
      creditsBilled: 1,
    });
    await backend.mutation(internal.tasks.sessions.update, { sessionId, active: false });
    expect(await backend.run((ctx) => scoutReservation(ctx, scoutId))).toBeNull();
    expect((await read(sessionId)).state).toEqual({ kind: "stopped" });
  },
);

it.each(engines)(
  "queues one %s resume check and makes Stop win over a late approval",
  async (engine) => {
    const { backend, admin, start, read } = await setup();
    const sessionId = await start(engine);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    await backend.mutation(internal.tasks.browsers.open, { sessionId, browser });
    await backend.mutation(internal.tasks.sessions.enterHandoff, { sessionId, ...handoff });
    await admin.mutation(api.tasks.sessions.resume, {
      sessionId,
      callId: handoff.callId,
      turnId: handoff.turnId,
    });
    const checking = await read(sessionId);
    if (checking.state.kind !== "checking") throw new Error("Resume must queue an admission check");
    const checkId = checking.state.checkId;
    await expect(
      admin.mutation(api.tasks.sessions.resume, {
        sessionId,
        callId: handoff.callId,
        turnId: handoff.turnId,
      }),
    ).rejects.toThrow("no longer waiting");
    const check = await backend.query(internal.tasks.requestChecks.get, { checkId });
    expect(check).toMatchObject({
      kind: "resume",
      sessionId,
      prompt,
      handoff,
      providerSessionId: browser.providerSessionId,
    });
    await backend.mutation(internal.tasks.requestChecks.start, {
      checkId,
      request: "Check current browser",
      startedAt: Date.now(),
      evidence: {
        capturedAt: Date.now(),
        pages: [
          { tabId: "tab-1", url: "https://example.test", title: "Example", content: "Verified" },
        ],
      },
    });
    await admin.mutation(api.tasks.sessions.stop, { sessionId });
    expect(
      await backend.mutation(internal.tasks.requestChecks.finish, {
        checkId,
        state: {
          kind: "completed",
          finishedAt: Date.now(),
          call: {
            startedAt: Date.now(),
            request: "Check current browser",
            response: "approved",
            usage: null,
          },
          result: { kind: "resume", decision: { kind: "approved" } },
        },
      }),
    ).toBe(false);
    expect(
      await backend.mutation(internal.tasks.requestChecks.releaseHandoff, { sessionId, checkId }),
    ).toBeNull();
    expect(await read(sessionId)).toMatchObject({
      engine,
      state: { kind: "stopped" },
      active: true,
    });
  },
);

it.each(engines)(
  "reuses %s call claims and preserves completed and uncertain outcomes",
  async (engine) => {
    const { backend, start } = await setup();
    const sessionId = await start(engine);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    const args = { sessionId, callId: "external-write" };
    const first = await backend.mutation(internal.tasks.sessions.claimCall, args);
    const interrupted = await backend.mutation(internal.tasks.sessions.claimCall, args);
    expect(first.fresh).toBe(true);
    expect(interrupted).toMatchObject({
      fresh: false,
      call: { _id: first.call._id, result: { kind: "running" } },
    });
    await backend.mutation(internal.tasks.sessions.finishCall, {
      callId: first.call._id,
      result: { kind: "success", output: "sent-once" },
    });
    expect(await backend.mutation(internal.tasks.sessions.claimCall, args)).toMatchObject({
      fresh: false,
      call: { _id: first.call._id, result: { kind: "success", output: "sent-once" } },
    });
    const failed = await backend.mutation(internal.tasks.sessions.claimCall, {
      sessionId,
      callId: "failed-write",
    });
    await backend.mutation(internal.tasks.sessions.finishCall, {
      callId: failed.call._id,
      result: { kind: "error", error: "Outcome needs inspection" },
    });
    expect(
      await backend.mutation(internal.tasks.sessions.claimCall, {
        sessionId,
        callId: "failed-write",
      }),
    ).toMatchObject({
      fresh: false,
      call: { result: { kind: "error", error: "Outcome needs inspection" } },
    });
    expect(
      await backend.run((ctx) =>
        ctx.db
          .query("agentsApiCalls")
          .withIndex("by_session_id_and_call_id", (q) => q.eq("sessionId", sessionId))
          .take(10),
      ),
    ).toHaveLength(2);
  },
);

it.each(engines)(
  "replaces repeated %s usage snapshots and deduplicates search charges",
  async (engine) => {
    const { backend, admin, start, read } = await setup();
    const sessionId = await start(engine);
    const usage = { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 500 };
    const search = {
      providerItemId: "search-once",
      kind: "web_search_call",
      text: "Found Example",
      details: "{}",
      complete: true,
    };
    await backend.mutation(internal.tasks.sessions.update, { sessionId, usage });
    await backend.mutation(internal.tasks.sessions.saveItems, { sessionId, items: [search] });
    const first = await admin.query(api.tasks.sessions.cost, { sessionId });
    await backend.mutation(internal.tasks.sessions.update, { sessionId, usage });
    await backend.mutation(internal.tasks.sessions.saveItems, { sessionId, items: [search] });
    expect(await admin.query(api.tasks.sessions.cost, { sessionId })).toEqual(first);
    expect(first.usage).toEqual(usage);
    expect(first.cost.modelEstimateUsd).toBeCloseTo(0.000728);
    expect(first.cost.webSearchUsd).toBeCloseTo(0.01);
    const next = { inputTokens: 1500, cachedInputTokens: 500, outputTokens: 750 };
    await backend.mutation(internal.tasks.sessions.update, { sessionId, usage: next });
    expect((await read(sessionId)).usage).toEqual(next);
    expect(
      (await admin.query(api.tasks.sessions.cost, { sessionId })).cost.modelEstimateUsd,
    ).toBeCloseTo(0.00111);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      usage: { inputTokens: 1500, outputTokens: 750 },
    });
    const unknown = await admin.query(api.tasks.sessions.cost, { sessionId });
    expect(unknown.cost.modelEstimateUsd).toBeNull();
    expect(unknown.cost.missing).toContain("cached_input_usage");
  },
);

it.each(engines)(
  "retains %s on follow-up and ignores the prior workflow's failure and refresh",
  async (engine) => {
    const { backend, admin, start, read } = await setup();
    const sessionId = await start(engine);
    const previous = await read(sessionId);
    if (!previous.workflowId) throw new Error("Task must have a workflow");
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      providerId: "consolidation-conversation",
      state: { kind: "idle" },
      active: false,
    });
    await admin.mutation(api.tasks.sessions.send, { sessionId, message: "Check the next page" });
    const current = await read(sessionId);
    expect(current).toMatchObject({ engine, state: { kind: "running" }, active: true });
    expect(current.workflowId).toBeDefined();
    expect(current.workflowId).not.toBe(previous.workflowId);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      refreshWorkflowId: previous.workflowId,
      usage: { inputTokens: 9999, outputTokens: 9999 },
      state: { kind: "failed", error: "Late refresh" },
    });
    await backend.mutation(internal.tasks.lifecycle.onComplete, {
      workflowId: previous.workflowId,
      context: { sessionId },
      result: { kind: "failed", error: "Late workflow failure" },
    });
    expect(await read(sessionId)).toEqual(current);
  },
);

it.each(products)(
  "revokes active %s execution and costs without blocking internal cleanup",
  async (kind) => {
    const { backend, member, memberId, product, read } = await setup();
    const sessionId = await product(kind);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    expect(await member.query(api.tasks.sessions.cost, { sessionId })).toMatchObject({
      usage: null,
    });
    await backend.run((ctx) => ctx.db.patch(memberId, { isApproved: false }));
    await expect(backend.query(internal.tasks.sessions.runtime, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(member.query(api.tasks.sessions.controls, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(member.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      member.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" }),
    ).rejects.toThrow("Not authorized");
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "failed", error: "Owner access revoked" },
    });
    await backend.mutation(internal.tasks.sessions.scheduleCleanup, { sessionId });
    expect((await read(sessionId)).cleanupJobId).toBeDefined();
  },
);

it("reads a persisted session without an engine as Agents API without rewriting it", async () => {
  const { backend, admin, start } = await setup();
  const sessionId = await start("agents_api");
  await backend.run((ctx) => ctx.db.patch(sessionId, { engine: undefined }));
  expect(await admin.query(api.tasks.sessions.get, { sessionId })).toMatchObject({
    engine: "agents_api",
  });
  expect((await admin.query(api.tasks.sessions.list, { paginationOpts })).page).toMatchObject([
    { _id: sessionId, engine: "agents_api" },
  ]);
  const persisted = await backend.run((ctx) => ctx.db.get(sessionId));
  expect(persisted).not.toBeNull();
  expect(persisted).not.toHaveProperty("engine");
});

it.each([
  { status: "failed", expected: "failed" },
  { status: "incomplete", expected: "interrupted" },
])("preserves native $status calls without a local result", async ({ status, expected }) => {
  const { backend, admin, start } = await setup();
  const sessionId = await start("agents_api");
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "running" },
  });
  await backend.mutation(internal.tasks.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: `native-${status}`,
        kind: "function_call",
        text: "browser_execute",
        details: JSON.stringify({
          type: "function_call",
          call_id: `native-${status}`,
          name: "browser_execute",
          arguments: { code: "await page.title()" },
          status,
        }),
        complete: true,
      },
    ],
  });
  const active = await admin.query(api.tasks.sessions.listItems, { sessionId, paginationOpts });
  expect(active.page[0]?.tool).toMatchObject({ state: expected });
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "idle" },
  });
  const idle = await admin.query(api.tasks.sessions.listItems, { sessionId, paginationOpts });
  expect(idle.page[0]?.tool).toMatchObject({ state: expected });
});

it.each(engines)(
  "normalizes %s tool activity without turning a tool-level failure into success",
  async (engine) => {
    const { backend, admin, start } = await setup();
    const sessionId = await start(engine);
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      state: { kind: "running" },
    });
    const callId = "applied-without-snapshot";
    const name = "browser_execute";
    const input = { code: "await page.getByRole('button', { name: 'Save' }).click()" };
    const item =
      engine === "convex_agent"
        ? {
            providerItemId: `convex:tool:${callId}`,
            kind: "tool_call",
            text: name,
            details: JSON.stringify({ callId, name, input }),
            complete: true,
          }
        : {
            providerItemId: "provider-tool-call",
            kind: "function_call",
            text: name,
            details: JSON.stringify({
              type: "function_call",
              call_id: callId,
              name,
              arguments: input,
              status: "completed",
            }),
            complete: true,
          };
    await backend.mutation(internal.tasks.sessions.saveItems, { sessionId, items: [item] });
    const emitted = await admin.query(api.tasks.sessions.listItems, { sessionId, paginationOpts });
    expect(emitted.page[0]?.tool).toMatchObject({ name, state: "running" });
    const claim = await backend.mutation(internal.tasks.sessions.claimCall, { sessionId, callId });
    await backend.mutation(internal.tasks.sessions.finishCall, {
      callId: claim.call._id,
      result: {
        kind: "success",
        output: JSON.stringify({
          type: "json",
          value: {
            success: false,
            error: "Snapshot failed after Save",
            mutationApplied: true,
            doNotRetry: true,
          },
        }),
      },
    });
    const completed = await admin.query(api.tasks.sessions.listItems, {
      sessionId,
      paginationOpts,
    });
    expect(completed.page).toHaveLength(1);
    expect(completed.page[0]?.tool).toMatchObject({
      name,
      state: "failed",
      error: "Snapshot failed after Save",
    });
    expect(completed.page[0]?.tool?.output).toContain('"mutationApplied": true');
    expect(completed.page[0]?.tool?.output).toContain('"doNotRetry": true');
  },
);
