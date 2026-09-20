/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vite-plus/test";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
type Reporting = NonNullable<Doc<"agentsApiCalls">["reporting"]>;

const completedReport = {
  startedAt: 1_000,
  model: "openai/gpt-5.6-luna",
  billable: false,
  request: "report request",
  state: {
    kind: "completed",
    finishedAt: 2_000,
    response: "report response",
    usage: {
      inputTokens: 10_000,
      outputTokens: 2_000,
      cachedInputTokens: null,
      reasoningTokens: null,
      costUsd: 0.02,
    },
    report: { summary: "The task passed", sections: [] },
  },
} satisfies Reporting;

async function setup(engine: "agents_api" | "convex_agent") {
  const backend = convexTest(schema, modules);
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "report-costs@example.com" });
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "inbox", address: "scout@example.com" },
      firecrawl: { profileName: "profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      engine,
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Report cost test",
      model: engine === "agents_api" ? "gpt-5.6-luna" : "openai/gpt-5.6-luna",
      state: { kind: "idle" },
      active: false,
      nextSequence: 0,
      browser: null,
      usage: { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 },
      reportedModelUsd: engine === "agents_api" ? null : 0.04,
    });
    await ctx.db.insert("scoutChats", {
      threadId: sessionId,
      runtime: { kind: "agents_api", sessionId },
      userId,
      scoutId,
      createdAt: 1_000,
      purpose: { kind: "review" },
      visibility: "private",
    });
    return { userId, adminId, sessionId };
  });
  return {
    backend,
    sessionId: ids.sessionId,
    owner: backend.withIdentity({ subject: ids.userId }),
    admin: backend.withIdentity({ subject: ids.adminId }),
  };
}

it.each(["agents_api", "convex_agent"] as const)(
  "adds completed and failed reporter charges once to %s owner and Lab costs",
  async (engine) => {
    const { backend, sessionId, owner, admin } = await setup(engine);
    const before = await backend.run((ctx) => ctx.db.get(sessionId));
    await backend.run(async (ctx) => {
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: "completed-report",
        result: { kind: "success", output: "saved" },
        reporting: completedReport,
      });
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: "failed-report",
        result: { kind: "error", error: "Invalid report" },
        reporting: {
          ...completedReport,
          billable: true,
          state: {
            kind: "failed",
            finishedAt: 2_000,
            response: "invalid report",
            usage: { ...completedReport.state.usage, costUsd: 0.03 },
            error: "Invalid report",
          },
        },
      });
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: "running-report",
        result: { kind: "running" },
        reporting: { ...completedReport, state: { kind: "running" } },
      });
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: "ordinary-tool",
        result: { kind: "success", output: "done" },
      });
    });

    const costs = await owner.query(api.tasks.sessions.cost, { sessionId });
    const inspected = await admin.query(api.tasks.sessions.get, { sessionId });
    const expected = (engine === "agents_api" ? 0.0008 : 0.04) + 0.05;
    expect(costs.cost.modelEstimateUsd).toBeCloseTo(expected);
    expect(costs.cost.knownSubtotalUsd).toBeCloseTo(expected);
    expect(costs.cost.totalEstimateUsd).toBeCloseTo(expected);
    expect(costs.cost.missing).toEqual([]);
    expect(inspected.cost).toEqual(costs.cost);
    expect(await owner.query(api.tasks.sessions.cost, { sessionId })).toEqual(costs);
    expect(await backend.run((ctx) => ctx.db.get(sessionId))).toEqual(before);
    expect(costs.usage).toEqual(before?.usage);

    await backend.run((ctx) =>
      ctx.db.patch(sessionId, {
        usage: { inputTokens: 2_000, outputTokens: 1_000, cachedInputTokens: 0 },
        reportedModelUsd: engine === "agents_api" ? null : 0.08,
      }),
    );
    const refreshed = await owner.query(api.tasks.sessions.cost, { sessionId });
    expect(refreshed.cost.totalEstimateUsd).toBeCloseTo(
      (engine === "agents_api" ? 0.0016 : 0.08) + 0.05,
    );
  },
);

it.each([
  { kind: "completed", usage: { ...completedReport.state.usage, costUsd: null } },
  { kind: "completed", usage: null },
  { kind: "failed", usage: { ...completedReport.state.usage, costUsd: null } },
  { kind: "failed", usage: null },
] as const)("retains known charges when a settled reporter has unknown cost: %j", async (state) => {
  const { backend, sessionId, owner, admin } = await setup("convex_agent");
  await backend.run(async (ctx) => {
    await ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "known-report",
      result: { kind: "success", output: "saved" },
      reporting: completedReport,
    });
    await ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "unknown-report",
      result: { kind: "running" },
      reporting: {
        ...completedReport,
        state:
          state.kind === "completed"
            ? { ...completedReport.state, usage: state.usage }
            : {
                kind: "failed",
                finishedAt: 2_000,
                response: null,
                usage: state.usage,
                error: "Reporting failed",
              },
      },
    });
  });
  const { cost } = await owner.query(api.tasks.sessions.cost, { sessionId });
  expect(cost.modelEstimateUsd).toBeCloseTo(0.06);
  expect(cost.knownSubtotalUsd).toBeCloseTo(0.06);
  expect(cost.totalEstimateUsd).toBeNull();
  expect(cost.missing).toEqual(["model_usage"]);
  expect((await admin.query(api.tasks.sessions.get, { sessionId })).cost).toEqual(cost);
  await backend.run((ctx) => ctx.db.patch(sessionId, { modelUsageIncomplete: true }));
  expect((await owner.query(api.tasks.sessions.cost, { sessionId })).cost.missing).toEqual([
    "model_usage",
  ]);
});

it("preserves unknown primary usage while keeping a known reporter subtotal", async () => {
  const { backend, sessionId, owner } = await setup("agents_api");
  await backend.run(async (ctx) => {
    await ctx.db.patch(sessionId, { usage: null });
    await ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "completed-report",
      result: { kind: "success", output: "saved" },
      reporting: completedReport,
    });
  });
  const { cost } = await owner.query(api.tasks.sessions.cost, { sessionId });
  expect(cost.modelEstimateUsd).toBeNull();
  expect(cost.knownSubtotalUsd).toBe(0.02);
  expect(cost.totalEstimateUsd).toBeNull();
  expect(cost.missing).toEqual(["model_usage"]);
});

it("recognizes reported zero as known without filling in missing token details", async () => {
  const { backend, sessionId, owner } = await setup("convex_agent");
  await backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "zero-report",
      result: { kind: "success", output: "saved" },
      reporting: {
        ...completedReport,
        state: {
          ...completedReport.state,
          usage: { ...completedReport.state.usage, costUsd: 0 },
        },
      },
    }),
  );
  const { cost } = await owner.query(api.tasks.sessions.cost, { sessionId });
  expect(cost.modelEstimateUsd).toBe(0.04);
  expect(cost.totalEstimateUsd).toBe(0.04);
  expect(cost.missing).toEqual([]);
});

it("includes 100 reports despite unrelated calls and rejects a partial total at 101 reports", async () => {
  const { backend, sessionId, owner, admin } = await setup("agents_api");
  await backend.run(async (ctx) => {
    for (let index = 0; index < 101; index++) {
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: `ordinary-${index}`,
        result: { kind: "success", output: "done" },
      });
    }
    for (let index = 0; index < 100; index++) {
      await ctx.db.insert("agentsApiCalls", {
        sessionId,
        callId: `report-${index}`,
        result: { kind: "success", output: "saved" },
        reporting: completedReport,
      });
    }
  });
  const { cost } = await owner.query(api.tasks.sessions.cost, { sessionId });
  expect(cost.totalEstimateUsd).toBeCloseTo(2.0008);
  expect((await admin.query(api.tasks.sessions.get, { sessionId })).cost).toEqual(cost);

  await backend.run((ctx) =>
    ctx.db.insert("agentsApiCalls", {
      sessionId,
      callId: "report-over-limit",
      result: { kind: "success", output: "saved" },
      reporting: completedReport,
    }),
  );
  await expect(owner.query(api.tasks.sessions.cost, { sessionId })).rejects.toThrow(
    "100 walkthrough updates limit",
  );
  await expect(admin.query(api.tasks.sessions.get, { sessionId })).rejects.toThrow(
    "100 walkthrough updates limit",
  );
});
