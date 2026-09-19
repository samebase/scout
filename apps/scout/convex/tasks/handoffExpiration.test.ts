/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { Firecrawl, SdkError } from "firecrawl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { HANDOFF_EXPIRED_REASON, handoffDeadlineMessage } from "../../shared/handoff";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const minute = 60_000;
const handoff = { callId: "help", turnId: "turn", message: "Complete verification" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-19T12:00:00Z"));
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(engine: NonNullable<Doc<"agentsApiSessions">["engine"]>, remainingMs: number) {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      engine,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      active: true,
      state: { kind: "running" },
      browser: null,
      usage: null,
      nextSequence: 0,
    });
    await ctx.db.insert("agentsApiRequestChecks", {
      kind: "initial",
      sessionId,
      model: "gpt-5.6-luna",
      prompt: "Test example.com",
      state: { kind: "pending" },
    });
    return { sessionId, userId, scoutId };
  });
  await backend.mutation(internal.tasks.browsers.open, {
    billable: false,
    sessionId: ids.sessionId,
    browser: {
      providerSessionId: "browser",
      providerExpiresAtMs: Date.now() + remainingMs,
      cdpUrl: "wss://example.test",
      liveViewUrl: null,
      interactiveLiveViewUrl: "https://example.test/control",
      currentUrl: null,
    },
  });
  const owner = backend.withIdentity({ subject: ids.userId });
  const read = () => backend.run((ctx) => ctx.db.get(ids.sessionId));
  const enter = () =>
    backend.mutation(internal.tasks.sessions.enterHandoff, {
      sessionId: ids.sessionId,
      ...handoff,
    });
  const expiration = {
    sessionId: ids.sessionId,
    callId: handoff.callId,
    turnId: handoff.turnId,
    expiresAt: Date.now() + Math.min(45 * minute, remainingMs),
  };
  return { backend, owner, read, enter, expiration, ...ids };
}

it.each(["agents_api", "convex_agent"] as const)(
  "%s expires at the saved deadline, retains the reason, and releases an already-expired browser",
  async (engine) => {
    const t = await setup(engine, engine === "agents_api" ? 20 * minute : 60 * minute);
    const deletion = vi
      .spyOn(Firecrawl.prototype, "deleteBrowser")
      .mockRejectedValue(new SdkError("Browser expired", 404));
    await t.enter();
    expect((await t.read())?.state).toMatchObject({
      kind: "waiting",
      expiresAt: t.expiration.expiresAt,
    });
    vi.setSystemTime(t.expiration.expiresAt - 1);
    expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
      false,
    );
    vi.setSystemTime(t.expiration.expiresAt);
    expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
      true,
    );
    const stopped = await t.read();
    expect(stopped).toMatchObject({
      active: true,
      state: { kind: "stopped", reason: "handoff_expired" },
    });
    expect(stopped?.cleanupJobId).toBeDefined();
    await t.owner.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
    expect((await t.read())?.cleanupJobId).toBe(stopped?.cleanupJobId);
    await t.backend.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(deletion).toHaveBeenCalledExactlyOnceWith("browser");
    expect(await t.read()).toMatchObject({
      active: false,
      browser: null,
      state: { reason: "handoff_expired" },
    });
    expect(await t.backend.run((ctx) => ctx.db.query("agentsApiCalls").unique())).toMatchObject({
      callId: handoff.callId,
      result: { kind: "interrupted", error: HANDOFF_EXPIRED_REASON },
    });
    expect(
      await t.backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").unique()),
    ).toMatchObject({ lifecycle: { kind: "closed" } });
    await t.backend.run((ctx) =>
      ctx.db.insert("scoutChats", {
        userId: t.userId,
        scoutId: t.scoutId,
        threadId: t.sessionId,
        createdAt: Date.now(),
        purpose: { kind: "review" },
        visibility: "public",
        runtime: { kind: "agents_api", sessionId: t.sessionId },
      }),
    );
    await t.backend.mutation(internal.tasks.sessions.saveItems, {
      sessionId: t.sessionId,
      items: [
        {
          providerItemId: "help-item",
          text: "",
          ...(engine === "convex_agent"
            ? {
                kind: "tool_call",
                details: JSON.stringify({
                  name: "request_browser_handoff",
                  callId: handoff.callId,
                  input: { message: handoff.message },
                }),
              }
            : {
                kind: "function_call",
                details: JSON.stringify({
                  type: "function_call",
                  name: "request_browser_handoff",
                  call_id: handoff.callId,
                  arguments: { message: handoff.message },
                  status: "completed",
                }),
              }),
        },
      ],
    });
    const transcript = await t.owner.query(api.scout.activity.messages, {
      threadId: t.sessionId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(transcript.page).toMatchObject([
      { kind: "tool", tool: { state: "interrupted", error: HANDOFF_EXPIRED_REASON } },
    ]);
  },
);

it.each(["rejected", "approved"] as const)(
  "keeps a %s Resume check safe when the original timer fires during checking",
  async (decision) => {
    const t = await setup("convex_agent", 60 * minute);
    await t.enter();
    await t.owner.mutation(api.tasks.sessions.resume, {
      sessionId: t.sessionId,
      callId: handoff.callId,
      turnId: handoff.turnId,
    });
    const checking = await t.read();
    if (checking?.state.kind !== "checking") throw new Error("Expected resume check");
    const checkId = checking.state.checkId;
    await t.backend.run((ctx) =>
      ctx.db.patch(checkId, {
        state: { kind: "running", startedAt: Date.now(), request: "{}" },
        evidence: { capturedAt: Date.now(), pages: [] },
      }),
    );
    vi.setSystemTime(t.expiration.expiresAt);
    expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
      false,
    );
    await t.backend.mutation(internal.tasks.requestChecks.finish, {
      checkId,
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
        result: {
          kind: "resume",
          decision:
            decision === "approved"
              ? { kind: "approved" }
              : { kind: "rejected", reason: "Outside task scope" },
        },
      },
    });
    if (decision === "rejected") {
      expect((await t.read())?.state).toMatchObject({
        kind: "waiting",
        expiresAt: t.expiration.expiresAt,
      });
      const jobs = await t.backend.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(20),
      );
      expect(jobs.filter((job) => job.name === "tasks/sessions:expireHandoff")).toHaveLength(2);
      expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
        true,
      );
    } else {
      await t.backend.mutation(internal.tasks.requestChecks.releaseHandoff, {
        sessionId: t.sessionId,
        checkId,
      });
      expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
        false,
      );
      await t.enter();
      expect(await t.backend.mutation(internal.tasks.sessions.expireHandoff, t.expiration)).toBe(
        false,
      );
      expect(await t.read()).toMatchObject({
        active: true,
        state: { kind: "waiting", expiresAt: t.expiration.expiresAt + 15 * minute },
      });
    }
  },
);

it("repairs only selected legacy handoffs using browser age, and rejects a late Resume", async () => {
  const t = await setup("agents_api", 60 * minute);
  const args = { sessionIds: [t.sessionId] };
  expect(await t.backend.mutation(internal.tasks.sessions.repairHandoffDeadlines, args)).toEqual(
    [],
  );
  await t.backend.run(async (ctx) => {
    const session = await ctx.db.get(t.sessionId);
    if (!session?.browser) throw new Error("Missing browser");
    const { providerExpiresAtMs: _expiry, ...browser } = session.browser;
    await ctx.db.patch(t.sessionId, { browser, state: { kind: "waiting", ...handoff } });
    const record = await ctx.db.query("agentsApiBrowserSessions").unique();
    if (!record) throw new Error("Missing browser record");
    await ctx.db.patch(record._id, {
      lifecycle: { kind: "active", openedAtMs: Date.now() - 13 * 60 * minute },
    });
  });
  expect(await t.backend.mutation(internal.tasks.sessions.repairHandoffDeadlines, args)).toEqual([
    { sessionId: t.sessionId, expiresAt: Date.now() - 12 * 60 * minute },
  ]);
  expect(await t.backend.mutation(internal.tasks.sessions.repairHandoffDeadlines, args)).toEqual(
    [],
  );
  await t.owner.mutation(api.tasks.sessions.resume, {
    sessionId: t.sessionId,
    callId: handoff.callId,
    turnId: handoff.turnId,
  });
  expect((await t.read())?.state).toEqual({ kind: "stopped", reason: "handoff_expired" });
});

it("emails the deadline to open the browser and explains the shorter active window", async () => {
  const t = await setup("convex_agent", 20 * minute);
  await t.backend.run((ctx) =>
    ctx.db.insert("scoutChats", {
      userId: t.userId,
      scoutId: t.scoutId,
      threadId: t.sessionId,
      createdAt: Date.now(),
      purpose: { kind: "review" },
      visibility: "private",
      runtime: { kind: "agents_api", sessionId: t.sessionId },
    }),
  );
  vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
  vi.stubEnv("SITE_URL", "https://example.test");
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ message_id: "mail", thread_id: "mail-thread" }));
  vi.stubGlobal("fetch", request);
  await t.enter();
  await t.backend.action(internal.tasks.handoff.notify, {
    sessionId: t.sessionId,
    callId: handoff.callId,
  });
  expect(request).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: expect.stringContaining(handoffDeadlineMessage(t.expiration.expiresAt, "UTC", "open")),
    }),
  );
  vi.setSystemTime(t.expiration.expiresAt);
  await t.backend.action(internal.tasks.handoff.notify, {
    sessionId: t.sessionId,
    callId: handoff.callId,
  });
  expect(request).toHaveBeenCalledTimes(1);
});
