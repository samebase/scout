/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { saveWorkspaceFile } from "../scout/workspaceTools";
import { researchSite, researchRequest, siteBrief } from "./siteResearchSources";

vi.mock("../scout/workspaceTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scout/workspaceTools")>()),
  saveWorkspaceFile: vi.fn().mockResolvedValue(undefined),
}));

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../agentsApi/${path.slice(2)}`,
      module,
    ]),
  ),
};

const startAgent = vi.fn<Firecrawl["startAgent"]>();
const getAgentStatus = vi.fn<Firecrawl["getAgentStatus"]>();
const cancelAgent = vi.fn<Firecrawl["cancelAgent"]>();
const result = {
  success: true,
  status: "completed" as const,
  expiresAt: "2026-09-16T00:00:00Z",
  creditsUsed: 12,
  data: {
    overview: "A public calculator.",
    facts: [{ text: "No account required.", sources: ["https://example.com/help"] }],
    unknowns: [],
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.mocked(saveWorkspaceFile).mockReset().mockResolvedValue(undefined);
  startAgent.mockReset().mockResolvedValue({ success: true, id: "job-1" });
  getAgentStatus.mockReset().mockResolvedValue(result);
  cancelAgent.mockReset().mockResolvedValue(true);
  vi.spyOn(Firecrawl.prototype, "startAgent").mockImplementation(startAgent);
  vi.spyOn(Firecrawl.prototype, "getAgentStatus").mockImplementation(getAgentStatus);
  vi.spyOn(Firecrawl.prototype, "cancelAgent").mockImplementation(cancelAgent);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(prompt = "Try https://example.com and tell me whether it works.") {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { userId, scoutId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    return { userId, scoutId };
  });
  const admin = backend.withIdentity({ subject: userId });
  await admin.mutation(api.scout.chats.startProductChat, {
    scoutId,
    prompt,
    kind: "review",
    visibility: "private",
  });
  const session = await backend.run((ctx) => ctx.db.query("agentsApiSessions").unique());
  if (!session) throw new Error("Missing session");
  const check = await backend.run((ctx) => ctx.db.query("agentsApiRequestChecks").unique());
  if (!check) throw new Error("Missing check");
  await backend.run((ctx) =>
    ctx.db.patch(check._id, {
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
        result: { kind: "initial", title: "Test Example", decision: { kind: "approved" } },
      },
    }),
  );
  return {
    backend,
    admin,
    sessionId: session._id,
    checkId: check._id,
    prompt,
    run: () =>
      backend.action(internal.agentsApi.siteResearch.run, { sessionId: session._id, prompt }),
    advance: () =>
      backend.action(internal.agentsApi.siteResearch.advance, { sessionId: session._id }),
    inspect: () =>
      admin.query(api.agentsApi.siteResearchRecords.inspect, { sessionId: session._id }),
  };
}

it("starts one bounded research job, saves a frozen brief, and keeps private notes out of shared research", async () => {
  const t = await setup(
    "Try https://example.com/invite?token=private-token. My private note is secret-note.",
  );
  expect(await t.run()).toBe(true);
  expect((await t.inspect())?.jobId).toBe("job-1");
  getAgentStatus.mockResolvedValueOnce({
    success: true,
    status: "processing",
    expiresAt: result.expiresAt,
  });
  expect(await t.advance()).toBe(true);
  expect(await t.advance()).toBe(false);
  expect(await t.inspect()).toMatchObject({
    site: "example.com",
    jobId: "job-1",
    reportedCredits: 12,
    state: {
      kind: "completed",
      brief: expect.stringContaining("A public calculator."),
      briefPath: "/workspace/research/brief.md",
    },
  });
  const files = vi.mocked(saveWorkspaceFile).mock.calls.map(([, args]) => args);
  expect(files.map((f) => f.path)).toEqual([
    "/workspace/research/request.json",
    "/workspace/research/result.json",
    "/workspace/research/brief.md",
    "/workspace/research/brief.md",
  ]);
  expect(files.at(-1)?.target).toEqual({ kind: "site", site: "example.com" });
  expect(
    files.every((f) => !f.text.includes("private-token") && !f.text.includes("secret-note")),
  ).toBe(true);
  expect(startAgent.mock.calls[0][0]).toMatchObject({
    maxCredits: 50,
    model: "spark-2",
    schema: { properties: { overview: { type: "string" } } },
  });
  expect((await t.backend.run((ctx) => ctx.db.query("scoutChats").unique()))?.primarySite).toBe(
    "example.com",
  );
  await t.run();
  expect(startAgent).toHaveBeenCalledTimes(1);
  await expect(
    t.backend.query(api.agentsApi.siteResearchRecords.inspect, { sessionId: t.sessionId }),
  ).rejects.toThrow();
});

it("skips ambiguous sites without provider calls", async () => {
  const t = await setup("Compare https://example.com with https://example.org");
  expect(await t.run()).toBe(false);
  expect((await t.inspect())?.state.kind).toBe("skipped");
  expect(startAgent).not.toHaveBeenCalled();
});

it("cannot research a rejected request", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.patch(t.checkId, { state: { kind: "cancelled" } }));
  await expect(t.run()).rejects.toThrow("approved request");
  expect(await t.backend.run((ctx) => ctx.db.query("sites").first())).toBeNull();
  expect(startAgent).not.toHaveBeenCalled();
});

it("schedules a site-owned capture at approved research start and keeps capture failure independent", async () => {
  const t = await setup();
  await t.run();
  const scheduled = await t.backend.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const previewJobs = scheduled.filter((job) => job.name === "scout/sitePreviews:ensure");
  expect(previewJobs).toHaveLength(1);
  expect(previewJobs[0].args).toEqual([{ site: "example.com" }]);
  const site = await t.backend.run((ctx) => ctx.db.query("sites").unique());
  expect(site?.hostname).toBe("example.com");
  vi.stubEnv("R2_BUCKET", "");
  await t.backend.action(internal.scout.sitePreviews.ensure, { site: "example.com" });
  expect(await t.backend.run((ctx) => ctx.db.query("sites").unique())).toMatchObject({
    preview: { kind: "failed" },
  });
  expect((await t.inspect())?.state.kind).toBe("running");
  await t.advance();
  expect((await t.inspect())?.state.kind).toBe("completed");
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiSessions").unique())).toMatchObject({
    state: { kind: "starting" },
    active: true,
  });
});

it("records provider failure and its raw response without failing the approved session", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({
    ...result,
    status: "failed",
    error: "Site unavailable",
    data: undefined,
  });
  expect(await t.advance()).toBe(false);
  expect(await t.inspect()).toMatchObject({
    state: { kind: "failed", error: "Site unavailable" },
    responsePath: "/workspace/research/result.json",
    credits: 12,
  });
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.state.kind).toBe("starting");
});

it("checks Stop again after saving the request, before launching paid research", async () => {
  const t = await setup();
  vi.mocked(saveWorkspaceFile).mockImplementationOnce(async () => {
    await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  });
  expect(await t.run()).toBe(false);
  expect(startAgent).not.toHaveBeenCalled();
  expect((await t.inspect())?.state.kind).toBe("cancelled");
});

it("cancels a job if Stop arrives during submission", async () => {
  const t = await setup();
  startAgent.mockImplementation(async () => {
    await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
    return { success: true, id: "job-1" };
  });
  expect(await t.run()).toBe(false);
  expect(cancelAgent).toHaveBeenCalledWith("job-1");
  expect((await t.inspect())?.state.kind).toBe("cancelled");
});

it("cancels running research on Stop and never starts the browser afterward", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({
    success: true,
    status: "processing",
    expiresAt: result.expiresAt,
  });
  await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  expect(await t.advance()).toBe(false);
  expect(cancelAgent).toHaveBeenCalledWith("job-1");
  expect(await t.inspect()).toMatchObject({ state: { kind: "cancelled" }, credits: null });
  expect(
    await t.backend.action(internal.agentsApi.runtime.begin, {
      sessionId: t.sessionId,
      command: { kind: "start", prompt: t.prompt, checkId: t.checkId },
    }),
  ).toBe(false);
});

it("cancels research at its deadline instead of polling forever", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({
    success: true,
    status: "processing",
    expiresAt: result.expiresAt,
  });
  vi.setSystemTime(Date.now() + 180_001);
  expect(await t.advance()).toBe(false);
  expect(cancelAgent).toHaveBeenCalledWith("job-1");
  expect((await t.inspect())?.state).toMatchObject({
    kind: "failed",
    error: expect.stringContaining("180 seconds"),
  });
});

it("preserves the workflow failure when cancelling its unfinished research", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({
    success: true,
    status: "processing",
    expiresAt: result.expiresAt,
  });
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, { state: { kind: "failed", error: "Workflow failed" } }),
  );
  expect(await t.advance()).toBe(false);
  expect(cancelAgent).toHaveBeenCalledWith("job-1");
  expect((await t.inspect())?.state).toMatchObject({
    kind: "failed",
    error: "Workflow failed",
  });
});

it("shows a cancellation failure instead of pretending the provider stopped", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({
    success: true,
    status: "processing",
    expiresAt: result.expiresAt,
  });
  cancelAgent.mockResolvedValue(false);
  await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await expect(t.advance()).rejects.toThrow("Could not cancel");
  expect((await t.inspect())?.state.kind).toBe("running");
});

it("rejects malformed briefs instead of giving the browser invented fallback data", async () => {
  const t = await setup();
  await t.run();
  getAgentStatus.mockResolvedValue({ ...result, data: { brief: "Wrong shape" } });
  await t.advance();
  expect((await t.inspect())?.state.kind).toBe("failed");
  expect(vi.mocked(saveWorkspaceFile).mock.calls.some(([, f]) => f.path.endsWith("brief.md"))).toBe(
    false,
  );
});

it("uses public origins and a concrete draft-7 schema for Firecrawl", () => {
  expect(researchSite("Try (https://example.com/invite?token=abc).")).toBe("example.com");
  for (const text of [
    "Find a calculator",
    "https://127.0.0.1",
    "https://localhost:5173",
    "https://u:p@example.com",
    "http://example.com",
  ])
    expect(researchSite(text)).toBeNull();
  const request = researchRequest("example.com");
  expect(request.schema.$schema).toContain("draft-07");
  expect(request.schema.properties).toHaveProperty("facts");
  expect(() =>
    siteBrief.parse({
      ...result.data,
      facts: [{ text: "Bad link", sources: ["javascript:alert(1)"] }],
    }),
  ).toThrow();
});
