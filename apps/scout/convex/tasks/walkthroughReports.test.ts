/// <reference types="vite/client" />
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { saveWalkthroughDraft, WalkthroughReportingError } from "./walkthroughReport";

const provider = vi.hoisted(() => ({ generate: vi.fn<LanguageModelV4["doGenerate"]>() }));
vi.mock("@convex-dev/ai-sdk-provider", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    convexGateway: (modelId: string) =>
      new MockLanguageModelV4({
        modelId,
        provider: "convexGateway",
        doGenerate: provider.generate,
      }),
  };
});

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
type Finish = FunctionArgs<typeof internal.tasks.walkthroughReports.finish>;
const callId = "save-walkthrough";
const startedAt = Date.parse("2026-09-20T09:00:00Z");
const model = "openai/gpt-5.6-luna";
const request = JSON.stringify({ prompt: "Private reporting input" });
const response = JSON.stringify({ id: "report-response" });
const usage = {
  inputTokens: 100,
  outputTokens: 30,
  cachedInputTokens: 20,
  reasoningTokens: 10,
  costUsd: 0.02,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  provider.generate.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(billingEnabled = false) {
  const backend = convexTest(schema, modules);
  const accounts = await backend.run(async (ctx) => {
    const ownerId = await insertTestAccount(ctx, { email: "owner@example.test" });
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const otherId = await insertTestAccount(ctx, { email: "other@example.test" });
    const walletId = await ctx.db.insert("creditWallets", {
      userId: ownerId,
      balanceUnits: 1_000_000,
      hold: { kind: "clear" },
    });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "test", address: "scout@example.test" },
      firecrawl: { profileName: "test" },
    });
    return { ownerId, adminId, otherId, walletId, scoutId };
  });
  const createTask = () =>
    backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("agentsApiSessions", {
        userId: accounts.ownerId,
        scoutId: accounts.scoutId,
        scoutName: "Scout",
        title: "Check export",
        model,
        state: { kind: "running" },
        active: true,
        billingEnabled,
        nextSequence: 0,
        browser: null,
        usage: null,
      });
      await ctx.db.insert("scoutChats", {
        threadId: sessionId,
        runtime: { kind: "agents_api", sessionId },
        userId: accounts.ownerId,
        scoutId: accounts.scoutId,
        createdAt: startedAt,
        purpose: { kind: "review" },
        visibility: "public",
      });
      const callRecordId = await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId,
        result: { kind: "running" },
      });
      const browserId = await ctx.db.insert("agentsApiBrowserSessions", {
        agentsSessionId: sessionId,
        sequence: 1,
        providerSessionId: `browser-${sessionId}`,
        viewport: { width: 1280, height: 800 },
        lifecycle: { kind: "active", openedAtMs: startedAt },
        nextOperationSequence: 1,
      });
      const operationId = await ctx.db.insert("agentsApiBrowserOperations", {
        sessionId: browserId,
        sequence: 0,
        toolCallId: "capture",
        action: { kind: "open", url: "https://example.test/export" },
        state: { kind: "prepared", preparedAtMs: startedAt },
        clickCapture: null,
      });
      const captureId = await ctx.db.insert("agentsApiScreenshots", {
        sessionId,
        operationId,
        browserSequence: 1,
        operationSequence: 0,
        note: "Export result",
        state: {
          kind: "ready",
          key: `screenshots/${sessionId}.png`,
          metadata: {
            tabId: "tab-1",
            url: "https://example.test/export",
            title: "Export",
            startedAtMs: startedAt,
            completedAtMs: startedAt + 100,
            width: 1280,
            height: 800,
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
          },
        },
      });
      const previous = {
        summary: "The export button is available.",
        checks: [{ label: "Export", result: "untested", explanation: "Not yet attempted." }],
        sections: [
          { heading: "Export", explanation: "The export button.", captureIds: [captureId] },
        ],
      } satisfies Parameters<typeof saveWalkthroughDraft>[3];
      await ctx.db.patch(sessionId, { walkthrough: previous });
      return { sessionId, callRecordId, captureId, previous };
    });
  const task = await createTask();
  const identity = { sessionId: task.sessionId, callId };
  const report = {
    ...task.previous,
    summary: "Export produced a downloadable CSV.",
    checks: [{ label: "Export", result: "passed", explanation: "The CSV contains the rows." }],
  } satisfies Parameters<typeof saveWalkthroughDraft>[3];
  return {
    ...accounts,
    ...task,
    backend,
    identity,
    report,
    createTask,
    owner: backend.withIdentity({ subject: accounts.ownerId }),
    other: backend.withIdentity({ subject: accounts.otherId }),
    admin: backend.withIdentity({ subject: accounts.adminId }),
    start: () =>
      backend.mutation(internal.tasks.walkthroughReports.start, {
        ...identity,
        model,
        request,
        startedAt,
      }),
    finish: (outcome: Finish["outcome"], details = { response, usage }) =>
      backend.mutation(internal.tasks.walkthroughReports.finish, {
        ...identity,
        ...details,
        outcome,
      }),
    snapshot: () =>
      backend.run(async (ctx) => ({
        session: await ctx.db.get(task.sessionId),
        call: await ctx.db.get(task.callRecordId),
        wallet: await ctx.db.get(accounts.walletId),
        charges: await ctx.db
          .query("creditEntries")
          .withIndex("by_user_id", (q) => q.eq("userId", accounts.ownerId))
          .take(10),
        total: await ctx.db
          .query("creditUsageTotals")
          .withIndex("by_source_key", (q) =>
            q.eq("sourceKey", `walkthrough:${task.sessionId}:${callId}`),
          )
          .unique(),
      })),
    saveDraft: (draft: Parameters<typeof saveWalkthroughDraft>[3], signal?: AbortSignal) =>
      backend.action(async (ctx) => {
        const session = await ctx.runQuery(internal.tasks.sessions.cleanupResources, {
          sessionId: task.sessionId,
        });
        return saveWalkthroughDraft(ctx, session, callId, draft, signal);
      }),
  };
}

it("restricts reporting details to admins and scopes reused call IDs to their task", async () => {
  const t = await setup();
  const otherTask = await t.createTask();
  await t.start();
  await t.backend.mutation(internal.tasks.walkthroughReports.start, {
    sessionId: otherTask.sessionId,
    callId,
    model,
    request: "Other task's private input",
    startedAt,
  });
  await t.finish({ kind: "completed", report: t.report });
  await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId: t.sessionId,
      callId: "ordinary-tool",
      result: { kind: "success", output: "done" },
    }),
  );

  for (const viewer of [t.owner, t.other, t.backend]) {
    await expect(
      viewer.query(api.tasks.walkthroughReports.list, { sessionId: t.sessionId }),
    ).rejects.toThrow("Not authorized");
    await expect(viewer.query(api.tasks.walkthroughReports.inspect, t.identity)).rejects.toThrow(
      "Not authorized",
    );
  }
  expect(
    await t.admin.query(api.tasks.walkthroughReports.list, { sessionId: t.sessionId }),
  ).toEqual([{ callId, startedAt, model, state: "completed" }]);
  expect(await t.admin.query(api.tasks.walkthroughReports.inspect, t.identity)).toEqual({
    startedAt,
    model,
    request,
    billable: false,
    state: { kind: "completed", finishedAt: startedAt, response, usage, report: t.report },
  });
  expect(
    await t.admin.query(api.tasks.walkthroughReports.inspect, {
      sessionId: otherTask.sessionId,
      callId,
    }),
  ).toMatchObject({ request: "Other task's private input", state: { kind: "running" } });
  for (const missing of ["ordinary-tool", "missing-call"]) {
    expect(
      await t.admin.query(api.tasks.walkthroughReports.inspect, {
        sessionId: t.sessionId,
        callId: missing,
      }),
    ).toBeNull();
  }
});

it("builds context from the previous report and this task's user requests in sequence order", async () => {
  const t = await setup();
  const other = await t.createTask();
  await t.backend.run(async (ctx) => {
    for (const item of [
      { sessionId: t.sessionId, sequence: 3, kind: "user", text: "Check export too" },
      { sessionId: t.sessionId, sequence: 2, kind: "assistant", text: "Private assistant output" },
      { sessionId: other.sessionId, sequence: 0, kind: "user", text: "Another task" },
      { sessionId: t.sessionId, sequence: 0, kind: "user", text: "Check the calculator" },
    ])
      await ctx.db.insert("agentsApiItems", {
        ...item,
        providerItemId: `${item.sessionId}:${item.sequence}`,
        details: "{}",
        complete: true,
      });
  });
  expect(
    await t.backend.query(internal.tasks.walkthroughReports.context, {
      sessionId: t.sessionId,
    }),
  ).toEqual({ previous: t.previous, requests: ["Check the calculator", "Check export too"] });
});

it("rejects reporting before start and refuses a second start without replacing its input", async () => {
  const t = await setup();
  await expect(t.finish({ kind: "completed", report: t.report })).rejects.toThrow(
    "Walkthrough reporting was not started",
  );
  await t.start();
  const before = await t.snapshot();
  await expect(
    t.backend.mutation(internal.tasks.walkthroughReports.start, {
      ...t.identity,
      model,
      request: "Replacement input",
      startedAt: startedAt + 1,
    }),
  ).rejects.toThrow("Walkthrough reporting has already started");
  expect(await t.snapshot()).toEqual(before);
});

it("keeps failed reporting output and usage without replacing the previous walkthrough", async () => {
  const t = await setup(true);
  await t.start();
  await t.finish({ kind: "failed", error: "Provider returned an invalid report" });
  const saved = await t.snapshot();
  expect(saved.session?.walkthrough).toEqual(t.previous);
  expect(saved.call?.reporting?.state).toEqual({
    kind: "failed",
    finishedAt: startedAt,
    response,
    usage,
    error: "Provider returned an invalid report",
  });
  expect(saved.total).toMatchObject({ totalCostMicrodollars: 20_000 });
  expect(saved.charges).toHaveLength(1);
});

it.each(["foreign capture", "pending capture", "invalid checks", "empty summary"])(
  "rolls back an invalid completion with %s, then records the failed attempt",
  async (invalid) => {
    const t = await setup(true);
    const foreign = await t.createTask();
    const report = { ...t.report };
    if (invalid === "foreign capture") report.sections = foreign.previous.sections;
    if (invalid === "pending capture")
      await t.backend.run((ctx) => ctx.db.patch(t.captureId, { state: { kind: "pending" } }));
    if (invalid === "invalid checks") report.checks = [];
    if (invalid === "empty summary") report.summary = " ";
    await t.start();
    const before = await t.snapshot();
    await expect(t.finish({ kind: "completed", report })).rejects.toThrow();
    expect(await t.snapshot()).toEqual(before);
    await t.finish({ kind: "failed", error: `Rejected ${invalid}` });
    const failed = await t.snapshot();
    expect(failed.session?.walkthrough).toEqual(t.previous);
    expect(failed.call?.reporting?.state).toMatchObject({
      kind: "failed",
      response,
      usage,
      error: `Rejected ${invalid}`,
    });
    expect(failed.charges).toHaveLength(1);
  },
);

it("rejects completion after Stop but still records the failed response and incurred usage", async () => {
  const t = await setup(true);
  await t.start();
  await t.owner.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
  const stopped = await t.snapshot();
  await expect(t.finish({ kind: "completed", report: t.report })).rejects.toThrow(
    "Task is no longer running",
  );
  expect(await t.snapshot()).toEqual(stopped);
  await t.finish({ kind: "failed", error: "Task is no longer running" });
  const failed = await t.snapshot();
  expect(failed.session).toMatchObject({ state: { kind: "stopped" }, walkthrough: t.previous });
  expect(failed.call?.reporting?.state).toEqual({
    kind: "failed",
    finishedAt: startedAt,
    response,
    usage,
    error: "Task is no longer running",
  });
  expect(failed.wallet?.balanceUnits).toBe(980_000);
  expect(failed.charges).toHaveLength(1);
});

it.each(["completed", "failed"])(
  "settles a %s report once even when a later finish changes the report and increases usage",
  async (kind) => {
    const t = await setup(true);
    await t.start();
    await t.finish(
      kind === "completed"
        ? { kind, report: t.report }
        : { kind: "failed", error: "Invalid provider response" },
    );
    const settled = await t.snapshot();
    expect(settled.wallet?.balanceUnits).toBe(980_000);
    expect(settled.charges).toHaveLength(1);
    expect(settled.total).toMatchObject({
      sourceKey: `walkthrough:${t.sessionId}:${callId}`,
      totalCostMicrodollars: 20_000,
    });
    expect(settled.session?.walkthrough).toEqual(kind === "completed" ? t.report : t.previous);
    vi.setSystemTime(startedAt + 5_000);
    await t.finish(
      { kind: "completed", report: { ...t.report, summary: "Late replacement" } },
      {
        response: "Late response",
        usage: { ...usage, costUsd: 0.5 },
      },
    );
    await t.finish({ kind: "failed", error: "Late failure" });
    expect(await t.snapshot()).toEqual(settled);
  },
);

it.each([false, true])(
  "captures billable=%s at start even if the task changes before finish",
  async (billable) => {
    const t = await setup(billable);
    await t.start();
    await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { billingEnabled: !billable }));
    await t.finish({ kind: "completed", report: t.report });
    const saved = await t.snapshot();
    expect(saved.call?.reporting?.billable).toBe(billable);
    expect(saved.wallet?.balanceUnits).toBe(billable ? 980_000 : 1_000_000);
    expect(saved.charges).toHaveLength(billable ? 1 : 0);
    expect(saved.session?.walkthrough).toEqual(t.report);
  },
);

function generatedReport(report: Parameters<typeof saveWalkthroughDraft>[3]) {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: "report",
        toolName: "save_walkthrough",
        input: JSON.stringify(report),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: {
      inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
      outputTokens: { total: 30, text: 20, reasoning: 10 },
      raw: { cost: 0.02 },
    },
    warnings: [],
  } satisfies Awaited<ReturnType<LanguageModelV4["doGenerate"]>>;
}

it("saves the first draft directly without making a reporting model call", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { walkthrough: undefined }));
  expect(await t.saveDraft(t.report)).toEqual(t.report);
  expect(provider.generate).not.toHaveBeenCalled();
  const saved = await t.snapshot();
  expect(saved.session?.walkthrough).toEqual(t.report);
  expect(saved.call?.reporting).toBeUndefined();
});

it("sends prior findings and user requests to the reporter, then saves and returns its merged report", async () => {
  const t = await setup(true);
  await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiItems", {
      sessionId: t.sessionId,
      sequence: 0,
      providerItemId: "user-1",
      kind: "user",
      text: "Verify CSV export",
      details: "{}",
      complete: true,
    }),
  );
  const merged = { ...t.report, summary: "The exported CSV preserves all rows." };
  provider.generate.mockResolvedValueOnce(generatedReport(merged));
  expect(await t.saveDraft(t.report)).toEqual(merged);
  expect(provider.generate).toHaveBeenCalledOnce();
  const input = provider.generate.mock.calls[0]?.[0];
  expect(input?.toolChoice).toEqual({ type: "tool", toolName: "save_walkthrough" });
  expect(JSON.stringify(input?.prompt)).toContain(t.previous.summary);
  expect(input?.prompt).toContainEqual({
    role: "user",
    content: [
      {
        type: "text",
        text: JSON.stringify({ userRequests: ["Verify CSV export"], draft: t.report }),
      },
    ],
  });
  const saved = await t.snapshot();
  expect(saved.session?.walkthrough).toEqual(merged);
  expect(saved.call?.reporting?.state).toMatchObject({
    kind: "completed",
    report: merged,
    response: expect.stringContaining(merged.summary),
    usage,
  });
});

it("preserves the previous report and accounts for a model response when cancellation wins before save", async () => {
  const t = await setup(true);
  const controller = new AbortController();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  provider.generate.mockImplementationOnce(async () => {
    controller.abort(new Error("Task stopped during walkthrough reporting"));
    return generatedReport(t.report);
  });
  await expect(t.saveDraft(t.report, controller.signal)).rejects.toBeInstanceOf(
    WalkthroughReportingError,
  );
  const saved = await t.snapshot();
  expect(saved.session?.walkthrough).toEqual(t.previous);
  expect(saved.call?.reporting?.state).toMatchObject({
    kind: "failed",
    response: expect.stringContaining(t.report.summary),
    error: expect.stringContaining("Task stopped during walkthrough reporting"),
    usage,
  });
  expect(saved.wallet?.balanceUnits).toBe(980_000);
  expect(log).toHaveBeenCalledOnce();
});
