/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { Firecrawl, SdkError } from "firecrawl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { saveWorkspaceFile } from "../scout/workspaceTools";
import { endResearch } from "./siteResearch";
import { researchSite, researchRequest, siteBrief } from "./siteResearchSources";

vi.mock("../scout/workspaceTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scout/workspaceTools")>()),
  saveWorkspaceFile: vi.fn().mockResolvedValue(undefined),
}));

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const startAgent = vi.fn<Firecrawl["startAgent"]>();
const getAgentStatus = vi.fn<Firecrawl["getAgentStatus"]>();
const cancelAgent = vi.fn<Firecrawl["cancelAgent"]>();
const fetchHomepage = vi.fn<typeof fetch>();
const result = {
  success: true,
  status: "completed",
  expiresAt: "2026-09-17T00:00:00Z",
  creditsUsed: 12,
  data: {
    name: "Example Calculator",
    overview: "A public calculator.",
    facts: [{ text: "No account required.", sources: ["https://example.com/help"] }],
    unknowns: ["Whether calculations can be exported."],
  },
} satisfies Awaited<ReturnType<Firecrawl["getAgentStatus"]>>;
const processing = {
  success: true,
  status: "processing",
  expiresAt: result.expiresAt,
} satisfies Awaited<ReturnType<Firecrawl["getAgentStatus"]>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T09:00:00Z"));
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.mocked(saveWorkspaceFile).mockReset().mockResolvedValue(undefined);
  startAgent.mockReset().mockResolvedValue({ success: true, id: "job-1" });
  getAgentStatus.mockReset().mockResolvedValue(result);
  cancelAgent.mockReset().mockResolvedValue(true);
  fetchHomepage.mockReset().mockRejectedValue(new Error("Unexpected network request"));
  vi.stubGlobal("fetch", fetchHomepage);
  vi.spyOn(Firecrawl.prototype, "startAgent").mockImplementation(startAgent);
  vi.spyOn(Firecrawl.prototype, "getAgentStatus").mockImplementation(getAgentStatus);
  vi.spyOn(Firecrawl.prototype, "cancelAgent").mockImplementation(cancelAgent);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(prompt = "Try https://example.com and tell me whether it works.") {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { userId, memberId, scoutId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const memberId = await insertTestAccount(ctx, { email: "reviewer@example.test" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    return { userId, memberId, scoutId };
  });
  const admin = backend.withIdentity({ subject: userId });
  const member = backend.withIdentity({ subject: memberId });
  await admin.mutation(api.scout.chats.startProductChat, {
    scoutId,
    prompt,
    product: { kind: "review" },
    visibility: "private",
  });
  const session = await backend.run((ctx) => ctx.db.query("agentsApiSessions").unique());
  if (!session) throw new Error("Missing session");
  const check = await backend.run((ctx) => ctx.db.query("agentsApiRequestChecks").unique());
  if (!check) throw new Error("Missing check");
  const { scoutName, model: sessionModel } = session;
  const checkModel = check.model;
  const approved = {
    kind: "completed",
    finishedAt: Date.now(),
    call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
    result: { kind: "initial", title: "Test Example", decision: { kind: "approved" } },
  } satisfies typeof check.state;
  await backend.run((ctx) => ctx.db.patch(check._id, { state: approved }));

  function task(sessionId: Id<"agentsApiSessions">, checkId: Id<"agentsApiRequestChecks">) {
    return {
      sessionId,
      checkId,
      run: () => backend.action(internal.tasks.siteResearch.run, { sessionId, prompt }),
      advance: () => backend.action(internal.tasks.siteResearch.advance, { sessionId }),
      inspect: () => admin.query(api.tasks.siteResearchRecords.inspect, { sessionId }),
    };
  }

  // Seed approved reviews directly so the Scout's UI busy check does not serialize tasks.
  async function addTask() {
    const ids = await backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("agentsApiSessions", {
        userId: memberId,
        scoutId,
        scoutName,
        title: "Another review",
        model: sessionModel,
        state: { kind: "starting" },
        active: true,
        nextSequence: 0,
        browser: null,
        usage: null,
      });
      await ctx.db.insert("scoutChats", {
        threadId: sessionId,
        runtime: { kind: "agents_api", sessionId },
        userId: memberId,
        scoutId,
        createdAt: Date.now(),
        purpose: { kind: "review" },
        visibility: "private",
      });
      const checkId = await ctx.db.insert("agentsApiRequestChecks", {
        sessionId,
        kind: "initial",
        model: checkModel,
        prompt,
        state: approved,
      });
      return { sessionId, checkId };
    });
    return task(ids.sessionId, ids.checkId);
  }

  const site = () => backend.run((ctx) => ctx.db.query("sites").unique());
  async function sharedJob() {
    const current = await site();
    if (!current?.researchId) throw new Error("Missing canonical site research");
    const research = await backend.query(internal.tasks.siteResearchRecords.job, {
      researchId: current.researchId,
    });
    if (!research) throw new Error("Missing shared research job");
    return research;
  }
  return {
    backend,
    admin,
    member,
    userId,
    memberId,
    prompt,
    ...task(session._id, check._id),
    addTask,
    site,
    sharedJob,
    records: () => backend.run((ctx) => ctx.db.query("agentsApiSiteResearch").collect()),
    process: (researchId: Id<"agentsApiSiteResearch">) =>
      backend.action(internal.tasks.siteResearch.process, { researchId }),
    refresh: () => admin.action(api.tasks.siteResearch.refresh, { site: "example.com" }),
  };
}

it("persists the site profile and frozen task brief without sharing private request data", async () => {
  const t = await setup(
    "Try https://example.com/invite?token=private-token. My private note is secret-note.",
  );
  expect(await t.run()).toBe(true);
  const shared = await t.sharedJob();
  expect(shared).toMatchObject({
    sessionId: null,
    userId: t.userId,
    site: "example.com",
    jobId: null,
    state: { kind: "running" },
  });
  expect(await t.inspect()).toMatchObject({
    sessionId: t.sessionId,
    jobId: null,
    state: { kind: "waiting", researchId: shared._id, reused: false },
  });
  expect(startAgent).not.toHaveBeenCalled();
  await t.process(shared._id);
  expect(await t.sharedJob()).toMatchObject({
    jobId: "job-1",
    requestPath: "/workspace/research/request.json",
    maxCredits: 50,
  });
  getAgentStatus.mockResolvedValueOnce(processing);
  await t.process(shared._id);
  expect(await t.advance()).toBe(true);
  vi.setSystemTime(Date.now() + 5_000);
  await t.process(shared._id);
  const researchedAt = Date.now();
  const profile = (await t.site())?.profile;
  expect(profile).toEqual({
    name: result.data.name,
    homepageUrl: "https://example.com/",
    overview: result.data.overview,
    brief: expect.stringContaining("# Example Calculator"),
    researchedAt,
  });
  expect(await t.sharedJob()).toMatchObject({
    credits: 12,
    responsePath: "/workspace/research/result.json",
    state: { kind: "completed", finishedAt: researchedAt, brief: profile?.brief },
  });
  vi.setSystemTime(Date.now() + 1_000);
  expect(await t.advance()).toBe(false);
  const task = await t.inspect();
  expect(task).toMatchObject({
    site: "example.com",
    jobId: null,
    credits: 12,
    requestPath: null,
    responsePath: null,
    state: {
      kind: "completed",
      finishedAt: Date.now(),
      brief: profile?.brief,
      briefPath: "/workspace/research/brief.md",
      source: { researchId: shared._id, researchedAt, reused: false },
    },
  });
  const files = vi.mocked(saveWorkspaceFile).mock.calls.map(([, args]) => args);
  expect(files.map((file) => file.path)).toEqual([
    "/workspace/research/request.json",
    "/workspace/research/result.json",
    "/workspace/research/brief.md",
    "/workspace/research/brief.md",
  ]);
  for (const file of files.slice(0, 3))
    expect(file.target).toEqual({ kind: "site", site: "example.com" });
  expect(files[3]).toMatchObject({
    target: { kind: "agent_session", sessionId: t.sessionId },
    userId: t.userId,
    text: profile?.brief,
  });
  expect(files[2].text).toBe(profile?.brief);
  expect(files[3].text).toContain("https://example.com/help");
  expect(files[3].text).toContain("## Unknowns");
  expect(
    files.every(
      (file) => !file.text.includes("private-token") && !file.text.includes("secret-note"),
    ),
  ).toBe(true);
  expect(startAgent).toHaveBeenCalledWith(
    expect.objectContaining({ urls: ["https://example.com/"], maxCredits: 50, model: "spark-2" }),
  );
  expect((await t.backend.run((ctx) => ctx.db.query("scoutChats").unique()))?.primarySite).toBe(
    "example.com",
  );
  await t.process(shared._id);
  expect(await t.advance()).toBe(false);
  expect(await t.run()).toBe(false);
  expect(await t.inspect()).toEqual(task);
  expect(await t.records()).toHaveLength(2);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(2);
  expect(cancelAgent).not.toHaveBeenCalled();
  expect(saveWorkspaceFile).toHaveBeenCalledTimes(4);
});

it("keeps repeated run calls waiting on the same shared job until it finishes", async () => {
  const t = await setup();
  expect(await t.run()).toBe(true);
  const shared = await t.sharedJob();
  expect(await t.run()).toBe(true);
  await t.process(shared._id);
  expect(await t.run()).toBe(true);
  await t.process(shared._id);
  expect(await t.run()).toBe(false);
  expect((await t.inspect())?.state.kind).toBe("completed");
  expect(await t.records()).toHaveLength(2);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
});

it("reuses completed research across users with zero task credits and no extra Firecrawl calls", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  await t.process(shared._id);
  await t.advance();
  const profile = (await t.site())?.profile;
  const second = await t.addTask();
  vi.setSystemTime(Date.now() + 30_000);
  expect(await second.run()).toBe(false);
  expect(await second.inspect()).toMatchObject({
    credits: 0,
    jobId: null,
    state: {
      kind: "completed",
      brief: profile?.brief,
      source: { researchId: shared._id, researchedAt: profile?.researchedAt, reused: true },
    },
  });
  expect(vi.mocked(saveWorkspaceFile).mock.calls.at(-1)?.[1]).toMatchObject({
    path: "/workspace/research/brief.md",
    text: profile?.brief,
    userId: t.memberId,
    target: { kind: "agent_session", sessionId: second.sessionId },
  });
  expect(await t.records()).toHaveLength(3);
  expect((await t.records()).filter((record) => record.sessionId === null)).toHaveLength(1);
  expect((await t.sharedJob()).credits).toBe(12);
  expect((await t.inspect())?.credits).toBe(12);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
  expect(cancelAgent).not.toHaveBeenCalled();
});

it("lets concurrent tasks share one paid job and attributes its credits only once", async () => {
  const t = await setup();
  const second = await t.addTask();
  expect(await Promise.all([t.run(), second.run()])).toEqual([true, true]);
  const shared = await t.sharedJob();
  expect([await t.inspect(), await second.inspect()]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        state: { kind: "waiting", researchId: shared._id, reused: false },
      }),
      expect.objectContaining({ state: { kind: "waiting", researchId: shared._id, reused: true } }),
    ]),
  );
  const scheduled = await t.backend.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.filter((job) => job.name === "tasks/siteResearch:process")).toHaveLength(1);
  expect(scheduled.filter((job) => job.name === "scout/sitePreviews:ensure")).toHaveLength(1);
  expect(await t.records()).toHaveLength(3);
  await t.process(shared._id);
  await t.process(shared._id);
  expect(await Promise.all([t.advance(), second.advance()])).toEqual([false, false]);
  const finished = [await t.inspect(), await second.inspect()];
  expect(finished.map((record) => record?.credits)).toEqual(expect.arrayContaining([0, 12]));
  for (const record of finished)
    expect(record).toMatchObject({
      state: { kind: "completed", source: { researchId: shared._id, researchedAt: Date.now() } },
    });
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
  expect(cancelAgent).not.toHaveBeenCalled();
});

it.each(["saving request", "submitting job"])(
  "keeps shared research alive when a task stops while %s",
  async (stage) => {
    const t = await setup();
    await t.run();
    const second = await t.addTask();
    await second.run();
    const shared = await t.sharedJob();
    const stop = () => t.admin.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
    if (stage === "saving request")
      vi.mocked(saveWorkspaceFile).mockImplementationOnce(async () => {
        await stop();
      });
    else
      startAgent.mockImplementationOnce(async () => {
        await stop();
        return { success: true, id: "job-1" };
      });
    await t.process(shared._id);
    expect(await t.advance()).toBe(false);
    expect((await t.inspect())?.state.kind).toBe("cancelled");
    expect(await t.sharedJob()).toMatchObject({ jobId: "job-1", state: { kind: "running" } });
    expect(await second.advance()).toBe(true);
    await t.process(shared._id);
    expect(await second.advance()).toBe(false);
    expect(await second.inspect()).toMatchObject({
      credits: 0,
      state: { kind: "completed", source: { researchId: shared._id, reused: true } },
    });
    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(getAgentStatus).toHaveBeenCalledTimes(1);
    expect(cancelAgent).not.toHaveBeenCalled();
  },
);

it.each(["advance", "cleanup"])(
  "%s cancels only a stopped task's wait and leaves the other waiter running",
  async (operation) => {
    const t = await setup();
    await t.run();
    const second = await t.addTask();
    await second.run();
    const shared = await t.sharedJob();
    await t.process(shared._id);
    await t.admin.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
    if (operation === "cleanup")
      await t.backend.action(internal.tasks.runtime.cleanup, { sessionId: t.sessionId });
    else expect(await t.advance()).toBe(false);
    expect(await t.inspect()).toMatchObject({ state: { kind: "cancelled" }, credits: null });
    expect(await t.sharedJob()).toMatchObject({ state: { kind: "running" }, jobId: "job-1" });
    expect(await second.advance()).toBe(true);
    expect(getAgentStatus).not.toHaveBeenCalled();
    expect(cancelAgent).not.toHaveBeenCalled();
    expect(
      await t.backend.action(internal.tasks.runtime.begin, {
        sessionId: t.sessionId,
        command: { kind: "start", prompt: t.prompt, checkId: t.checkId },
      }),
    ).toBe(false);
    await t.process(shared._id);
    await second.advance();
    expect((await second.inspect())?.state.kind).toBe("completed");
    expect((await t.inspect())?.state.kind).toBe("cancelled");
    expect((await t.sharedJob()).state.kind).toBe("completed");
    const copied = vi
      .mocked(saveWorkspaceFile)
      .mock.calls.filter(([, file]) => file.target.kind === "agent_session");
    expect(copied).toHaveLength(1);
    expect(copied[0][1].target).toEqual({ kind: "agent_session", sessionId: second.sessionId });
    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(getAgentStatus).toHaveBeenCalledTimes(1);
    expect(cancelAgent).not.toHaveBeenCalled();
  },
);

it("preserves a failed workflow's error while its shared research finishes independently", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, { state: { kind: "failed", error: "Workflow failed" } }),
  );
  expect(await t.advance()).toBe(false);
  expect((await t.inspect())?.state).toMatchObject({ kind: "failed", error: "Workflow failed" });
  expect((await t.sharedJob()).state.kind).toBe("running");
  await t.process(shared._id);
  expect((await t.sharedJob()).state.kind).toBe("completed");
  expect((await t.inspect())?.state).toMatchObject({ kind: "failed", error: "Workflow failed" });
  expect(cancelAgent).not.toHaveBeenCalled();
});

it("refreshes completed research once without changing historical or already waiting task briefs", async () => {
  const t = await setup();
  await t.run();
  const original = await t.sharedJob();
  const waiting = await t.addTask();
  await waiting.run();
  await t.process(original._id);
  await t.process(original._id);
  await t.advance();
  const historical = await t.inspect();
  const originalProfile = (await t.site())?.profile;
  vi.setSystemTime(Date.now() + 30_000);
  const refreshedId = await t.refresh();
  expect(refreshedId).not.toBe(original._id);
  expect(await t.refresh()).toBe(refreshedId);
  expect(await t.site()).toMatchObject({ researchId: refreshedId, profile: originalProfile });
  expect(await t.sharedJob()).toMatchObject({
    sessionId: null,
    userId: t.userId,
    state: { kind: "running" },
  });
  startAgent.mockResolvedValueOnce({ success: true, id: "job-2" });
  const refreshedData = {
    ...result.data,
    name: "Example Workspace",
    overview: "A calculator with saved worksheets.",
  };
  getAgentStatus.mockResolvedValueOnce({ ...result, data: refreshedData, creditsUsed: 8 });
  await t.process(refreshedId);
  await t.process(refreshedId);
  const refreshedProfile = (await t.site())?.profile;
  expect(refreshedProfile).toEqual({
    name: "Example Workspace",
    homepageUrl: "https://example.com/",
    overview: refreshedData.overview,
    brief: expect.stringContaining("A calculator with saved worksheets."),
    researchedAt: Date.now(),
  });
  expect(await waiting.advance()).toBe(false);
  expect(await waiting.inspect()).toMatchObject({
    credits: 0,
    state: {
      kind: "completed",
      brief: originalProfile?.brief,
      source: {
        researchId: original._id,
        researchedAt: originalProfile?.researchedAt,
        reused: true,
      },
    },
  });
  const latest = await t.addTask();
  expect(await latest.run()).toBe(false);
  expect(await latest.inspect()).toMatchObject({
    credits: 0,
    state: {
      kind: "completed",
      brief: refreshedProfile?.brief,
      source: { researchId: refreshedId, researchedAt: Date.now(), reused: true },
    },
  });
  expect(await t.inspect()).toEqual(historical);
  expect((await t.records()).filter((record) => record.sessionId === null)).toHaveLength(2);
  expect(await t.records()).toHaveLength(5);
  expect(startAgent).toHaveBeenCalledTimes(2);
  expect(getAgentStatus).toHaveBeenCalledTimes(2);
  expect(cancelAgent).not.toHaveBeenCalled();
  const firstCopies = vi
    .mocked(saveWorkspaceFile)
    .mock.calls.filter(
      ([, file]) => file.target.kind === "agent_session" && file.target.sessionId === t.sessionId,
    );
  expect(firstCopies).toHaveLength(1);
});

it("reuses failed research without inventing metadata and retries only after admin refresh", async () => {
  const t = await setup();
  await t.run();
  const failedJob = await t.sharedJob();
  await t.process(failedJob._id);
  const failedResponse = {
    ...result,
    status: "failed",
    error: "Site unavailable",
    data: undefined,
  } satisfies Awaited<ReturnType<Firecrawl["getAgentStatus"]>>;
  getAgentStatus.mockResolvedValueOnce(failedResponse);
  await t.process(failedJob._id);
  expect(await t.advance()).toBe(false);
  const failedTask = await t.inspect();
  expect(failedTask).toMatchObject({
    state: { kind: "failed", error: "Site unavailable" },
    credits: 12,
    responsePath: null,
  });
  expect(await t.sharedJob()).toMatchObject({
    state: { kind: "failed", error: "Site unavailable" },
    credits: 12,
    responsePath: "/workspace/research/result.json",
  });
  expect((await t.site())?.profile).toBeUndefined();
  expect(vi.mocked(saveWorkspaceFile).mock.calls.at(-1)?.[1]).toMatchObject({
    target: { kind: "site", site: "example.com" },
    text: JSON.stringify(failedResponse, null, 2),
  });
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.state.kind).toBe("starting");
  const second = await t.addTask();
  expect(await second.run()).toBe(false);
  expect(await second.inspect()).toMatchObject({
    credits: 0,
    state: { kind: "failed", error: "Site unavailable" },
  });
  await t.process(failedJob._id);
  expect((await t.site())?.researchId).toBe(failedJob._id);
  expect(await t.records()).toHaveLength(3);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(saveWorkspaceFile).mock.calls.some(([, file]) => file.path.endsWith("brief.md")),
  ).toBe(false);
  const retryId = await t.refresh();
  expect(retryId).not.toBe(failedJob._id);
  expect(await t.refresh()).toBe(retryId);
  startAgent.mockResolvedValueOnce({ success: true, id: "job-2" });
  const retrying = await t.addTask();
  expect(await retrying.run()).toBe(true);
  await t.process(retryId);
  await t.process(retryId);
  expect(await retrying.advance()).toBe(false);
  expect(await retrying.inspect()).toMatchObject({
    credits: 0,
    state: { kind: "completed", source: { researchId: retryId, reused: true } },
  });
  expect(await t.site()).toMatchObject({
    researchId: retryId,
    profile: { name: result.data.name },
  });
  expect(await t.inspect()).toEqual(failedTask);
  expect((await second.inspect())?.state.kind).toBe("failed");
  expect(await t.records()).toHaveLength(5);
  expect(startAgent).toHaveBeenCalledTimes(2);
  expect(getAgentStatus).toHaveBeenCalledTimes(3);
});

it("refuses refresh until an uncertain previous provider job is confirmed stopped", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  getAgentStatus.mockResolvedValue(processing);
  cancelAgent.mockResolvedValue(false);
  vi.setSystemTime(Math.ceil(shared._creationTime) + 180_000);
  await t.process(shared._id);
  await t.advance();
  const failedTask = await t.inspect();
  expect((await t.sharedJob()).state.kind).toBe("failed");
  await expect(t.refresh()).rejects.toThrow("Could not stop");
  expect((await t.site())?.researchId).toBe(shared._id);
  expect(await t.records()).toHaveLength(2);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(cancelAgent).toHaveBeenCalledTimes(2);

  getAgentStatus.mockRejectedValueOnce(new Error("Status unavailable"));
  await expect(t.refresh()).rejects.toThrow("Status unavailable");
  expect((await t.site())?.researchId).toBe(shared._id);
  expect(await t.records()).toHaveLength(2);
  expect(cancelAgent).toHaveBeenCalledTimes(2);

  cancelAgent.mockResolvedValue(true);
  const retryId = await t.refresh();
  expect(retryId).not.toBe(shared._id);
  expect(await t.refresh()).toBe(retryId);
  expect(await t.records()).toHaveLength(3);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(4);
  expect(cancelAgent).toHaveBeenCalledTimes(3);
  expect(await t.inspect()).toEqual(failedTask);
});

it.each([404, 410])(
  "refreshes when Firecrawl confirms the old job is absent with SDK status %i",
  async (status) => {
    const t = await setup();
    await t.run();
    const shared = await t.sharedJob();
    await t.process(shared._id);
    getAgentStatus.mockResolvedValueOnce({
      ...result,
      status: "failed",
      error: "Research failed",
      data: undefined,
    });
    await t.process(shared._id);
    getAgentStatus.mockRejectedValueOnce(new SdkError("Research job no longer exists", status));
    const refreshedId = await t.refresh();
    expect(refreshedId).not.toBe(shared._id);
    expect(await t.refresh()).toBe(refreshedId);
    expect(await t.sharedJob()).toMatchObject({ jobId: null, state: { kind: "running" } });
    expect(await t.records()).toHaveLength(3);
    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(getAgentStatus).toHaveBeenCalledTimes(2);
    expect(getAgentStatus).toHaveBeenLastCalledWith("job-1");
    expect(cancelAgent).not.toHaveBeenCalled();
  },
);

it.each([
  { label: "generic error mentioning 404", error: new Error("404 Not Found") },
  { label: "SDK 500", error: new SdkError("Server error", 500) },
  { label: "SDK 503", error: new SdkError("Service unavailable", 503) },
])(
  "blocks refresh when the old provider job cannot be confirmed absent: $label",
  async ({ error }) => {
    const t = await setup();
    await t.run();
    const shared = await t.sharedJob();
    await t.process(shared._id);
    getAgentStatus.mockResolvedValueOnce({
      ...result,
      status: "failed",
      error: "Research failed",
      data: undefined,
    });
    await t.process(shared._id);
    const before = await t.records();
    getAgentStatus.mockRejectedValueOnce(error);
    await expect(t.refresh()).rejects.toThrow(error.message);
    expect((await t.site())?.researchId).toBe(shared._id);
    expect(await t.records()).toEqual(before);
    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(getAgentStatus).toHaveBeenCalledTimes(2);
    expect(cancelAgent).not.toHaveBeenCalled();
  },
);

it("persists a known provider job ID when ending research after its submission was not saved", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  expect(shared.jobId).toBeNull();
  getAgentStatus.mockResolvedValue(processing);
  cancelAgent.mockResolvedValue(false);
  await t.backend.action((ctx) =>
    endResearch(
      ctx,
      { ...shared, jobId: "accepted-but-unsaved" },
      {
        kind: "failed",
        finishedAt: Date.now(),
        error: "Could not persist submission",
      },
    ),
  );
  expect(await t.sharedJob()).toMatchObject({
    jobId: "accepted-but-unsaved",
    credits: null,
    state: { kind: "failed", error: expect.stringContaining("Could not persist submission") },
  });
  expect(getAgentStatus).toHaveBeenCalledExactlyOnceWith("accepted-but-unsaved");
  expect(cancelAgent).toHaveBeenCalledExactlyOnceWith("accepted-but-unsaved");
  await expect(t.refresh()).rejects.toThrow("Could not stop");
  expect(await t.records()).toHaveLength(2);
  expect(getAgentStatus).toHaveBeenLastCalledWith("accepted-but-unsaved");
  expect(cancelAgent).toHaveBeenLastCalledWith("accepted-but-unsaved");
  expect(startAgent).not.toHaveBeenCalled();
});

it("serializes concurrent refreshes and ignores a stale expected research ID", async () => {
  const t = await setup();
  await t.run();
  const original = await t.sharedJob();
  await t.process(original._id);
  await t.process(original._id);
  const [firstId, secondId] = await Promise.all([t.refresh(), t.refresh()]);
  expect(firstId).toBe(secondId);
  expect(firstId).not.toBe(original._id);
  expect(await t.records()).toHaveLength(3);
  startAgent.mockResolvedValueOnce({ success: true, id: "job-2" });
  await t.process(firstId);
  await t.process(firstId);
  expect(
    await t.backend.mutation(internal.tasks.siteResearchRecords.refresh, {
      site: "example.com",
      userId: t.userId,
      expectedResearchId: original._id,
    }),
  ).toBe(firstId);
  expect((await t.site())?.researchId).toBe(firstId);
  expect(await t.records()).toHaveLength(3);
  expect(startAgent).toHaveBeenCalledTimes(2);
  expect(getAgentStatus).toHaveBeenCalledTimes(2);
});

it("starts shared research when the agent identifies a site later and keeps its skipped task snapshot", async () => {
  const t = await setup("Find a public calculator and try it.");
  expect(await t.run()).toBe(false);
  const skipped = await t.inspect();
  expect(skipped?.state.kind).toBe("skipped");
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { state: { kind: "running" } }));
  expect(
    await t.backend.mutation(internal.scout.reviewSites.identify, {
      sessionId: t.sessionId,
      site: "example.com",
    }),
  ).toEqual({ primarySite: "example.com" });
  const shared = await t.sharedJob();
  expect(shared).toMatchObject({ sessionId: null, userId: t.userId, state: { kind: "running" } });
  await t.backend.mutation(internal.scout.reviewSites.identify, {
    sessionId: t.sessionId,
    site: "example.com",
  });
  expect(await t.records()).toHaveLength(2);
  await t.process(shared._id);
  await t.process(shared._id);
  expect((await t.site())?.profile).toMatchObject({ name: result.data.name });
  expect(await t.advance()).toBe(false);
  expect(await t.inspect()).toEqual(skipped);
  expect(
    vi.mocked(saveWorkspaceFile).mock.calls.every(([, file]) => file.target.kind === "site"),
  ).toBe(true);
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
});

it("does not replace a completed task brief when the agent identifies its site again", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  await t.process(shared._id);
  await t.advance();
  const completed = await t.inspect();
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { state: { kind: "running" } }));
  expect(
    await t.backend.mutation(internal.scout.reviewSites.identify, {
      sessionId: t.sessionId,
      site: "different.example",
    }),
  ).toEqual({ primarySite: "example.com" });
  expect(await t.inspect()).toEqual(completed);
  expect((await t.site())?.researchId).toBe(shared._id);
  expect(await t.records()).toHaveLength(2);
  expect(saveWorkspaceFile).toHaveBeenCalledTimes(4);
  expect(startAgent).toHaveBeenCalledTimes(1);
});

it("skips ambiguous sites without creating a shared job or calling Firecrawl", async () => {
  const t = await setup("Compare https://example.com with https://example.org");
  expect(await t.run()).toBe(false);
  expect(await t.inspect()).toMatchObject({ site: null, credits: 0, state: { kind: "skipped" } });
  expect(await t.site()).toBeNull();
  expect(await t.records()).toHaveLength(1);
  expect(startAgent).not.toHaveBeenCalled();
  expect(getAgentStatus).not.toHaveBeenCalled();
});

it("rejects an unapproved request before creating a site, task wait, or paid job", async () => {
  const t = await setup();
  await t.backend.run((ctx) =>
    ctx.db.patch(t.checkId, {
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
        result: {
          kind: "initial",
          title: "Rejected request",
          decision: { kind: "rejected", reason: "Not permitted" },
        },
      },
    }),
  );
  await expect(t.run()).rejects.toThrow("approved request");
  expect(await t.site()).toBeNull();
  expect(await t.records()).toHaveLength(0);
  expect(await t.inspect()).toBeNull();
  expect(startAgent).not.toHaveBeenCalled();
  expect(saveWorkspaceFile).not.toHaveBeenCalled();
});

it("keeps a failed site preview independent of the shared research and approved task", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  const scheduled = await t.backend.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const previewJobs = scheduled.filter((job) => job.name === "scout/sitePreviews:ensure");
  expect(previewJobs).toHaveLength(1);
  expect(previewJobs[0].args).toEqual([{ site: "example.com" }]);
  vi.stubEnv("R2_BUCKET", "");
  await t.backend.action(internal.scout.sitePreviews.ensure, { site: "example.com" });
  expect(await t.site()).toMatchObject({ preview: { kind: "failed" } });
  expect((await t.inspect())?.state.kind).toBe("waiting");
  await t.process(shared._id);
  await t.process(shared._id);
  await t.advance();
  expect(await t.site()).toMatchObject({
    preview: { kind: "failed" },
    profile: { name: result.data.name },
  });
  expect((await t.inspect())?.state.kind).toBe("completed");
  expect(await t.backend.run((ctx) => ctx.db.get(t.sessionId))).toMatchObject({
    state: { kind: "starting" },
    active: true,
  });
});

it("bounds shared polling at 180 seconds and reports the failure to every waiter", async () => {
  const t = await setup();
  await t.run();
  const second = await t.addTask();
  await second.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  getAgentStatus.mockResolvedValue(processing);
  vi.setSystemTime(shared._creationTime + 179_999);
  await t.process(shared._id);
  expect((await t.sharedJob()).state.kind).toBe("running");
  expect(cancelAgent).not.toHaveBeenCalled();
  const scheduledBeforeTimeout = await t.backend.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  vi.setSystemTime(Math.ceil(shared._creationTime) + 180_000);
  await t.process(shared._id);
  expect(await t.sharedJob()).toMatchObject({
    state: { kind: "failed", error: expect.stringContaining("180 seconds") },
    credits: null,
  });
  expect(await t.advance()).toBe(false);
  expect(await second.advance()).toBe(false);
  expect(await t.inspect()).toMatchObject({
    credits: null,
    state: { kind: "failed", error: expect.stringContaining("180 seconds") },
  });
  expect(await second.inspect()).toMatchObject({
    credits: 0,
    state: { kind: "failed", error: expect.stringContaining("180 seconds") },
  });
  await t.process(shared._id);
  expect(
    await t.backend.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(scheduledBeforeTimeout.length);
  expect(cancelAgent).toHaveBeenCalledExactlyOnceWith("job-1");
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(2);
});

it("does not submit a paid job when its scheduled start already exceeded the deadline", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  vi.setSystemTime(Math.ceil(shared._creationTime) + 180_000);
  await t.process(shared._id);
  await t.advance();
  expect((await t.inspect())?.state).toMatchObject({
    kind: "failed",
    error: expect.stringContaining("180 seconds"),
  });
  expect(startAgent).not.toHaveBeenCalled();
  expect(getAgentStatus).not.toHaveBeenCalled();
  expect(cancelAgent).not.toHaveBeenCalled();
});

it.each(["cancel refused", "cancel threw", "status threw"])(
  "persists a failed shared job when deadline cleanup fails: %s",
  async (failure) => {
    const t = await setup();
    await t.run();
    const shared = await t.sharedJob();
    await t.process(shared._id);
    getAgentStatus.mockResolvedValue(processing);
    if (failure === "cancel refused") cancelAgent.mockResolvedValue(false);
    else if (failure === "cancel threw")
      cancelAgent.mockRejectedValue(new Error("Cancel unavailable"));
    else getAgentStatus.mockRejectedValue(new Error("Status unavailable"));
    vi.setSystemTime(Math.ceil(shared._creationTime) + 180_000);
    await expect(t.process(shared._id)).resolves.toBeNull();
    expect(await t.sharedJob()).toMatchObject({
      credits: null,
      state: { kind: "failed", error: expect.stringContaining("Firecrawl cleanup failed") },
    });
    expect(await t.advance()).toBe(false);
    expect(await t.inspect()).toMatchObject({
      credits: null,
      state: { kind: "failed", error: expect.stringContaining("180 seconds") },
    });
    await t.process(shared._id);
    expect(getAgentStatus).toHaveBeenCalledTimes(1);
    if (failure === "status threw") expect(cancelAgent).not.toHaveBeenCalled();
    else expect(cancelAgent).toHaveBeenCalledExactlyOnceWith("job-1");
  },
);

it.each([
  { label: "wrong shape", data: { brief: "Wrong shape" } },
  {
    label: "missing name",
    data: {
      overview: result.data.overview,
      facts: [],
      unknowns: [],
    },
  },
  { label: "blank name", data: { ...result.data, name: "   " } },
])("rejects $label without inventing a name or saving a task brief", async ({ data }) => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  getAgentStatus.mockResolvedValue({ ...result, data });
  await t.process(shared._id);
  expect(await t.advance()).toBe(false);
  expect((await t.sharedJob()).state.kind).toBe("failed");
  expect((await t.inspect())?.state.kind).toBe("failed");
  expect((await t.site())?.profile).toBeUndefined();
  expect(
    vi.mocked(saveWorkspaceFile).mock.calls.some(([, file]) => file.path.endsWith("brief.md")),
  ).toBe(false);
  expect(startAgent).toHaveBeenCalledTimes(1);
});

it("ignores a provider-added homepage and persists the submitted root without fetching it", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  const data = { ...result.data, homepageUrl: "https://wrong.example/" };
  getAgentStatus.mockResolvedValue({ ...result, data });
  await t.process(shared._id);
  expect(await t.advance()).toBe(false);
  expect(siteBrief.parse(data)).toEqual(result.data);
  const profile = (await t.site())?.profile;
  expect(profile).toMatchObject({ homepageUrl: "https://example.com/", name: result.data.name });
  expect(profile?.brief).not.toContain("wrong.example");
  expect(await t.inspect()).toMatchObject({
    state: {
      kind: "completed",
      brief: profile?.brief,
      source: { researchId: shared._id, reused: false },
    },
  });
  expect(fetchHomepage).not.toHaveBeenCalled();
  expect(startAgent).toHaveBeenCalledTimes(1);
  expect(getAgentStatus).toHaveBeenCalledTimes(1);
});

it("requires admin access for refresh and inspect without creating unauthorized work", async () => {
  const t = await setup();
  await t.run();
  const shared = await t.sharedJob();
  await t.process(shared._id);
  await t.process(shared._id);
  const before = await t.records();
  for (const viewer of [t.backend, t.member]) {
    await expect(
      viewer.action(api.tasks.siteResearch.refresh, { site: "example.com" }),
    ).rejects.toThrow("Not authorized");
    await expect(
      viewer.query(api.tasks.siteResearchRecords.inspect, { sessionId: t.sessionId }),
    ).rejects.toThrow("Not authorized");
  }
  expect(await t.records()).toEqual(before);
  expect((await t.site())?.researchId).toBe(shared._id);
  const refreshedId = await t.refresh();
  expect(refreshedId).not.toBe(shared._id);
  expect(await t.sharedJob()).toMatchObject({ userId: t.userId, sessionId: null });
  expect(await t.records()).toHaveLength(3);
  expect(startAgent).toHaveBeenCalledTimes(1);
});

it.each([
  "https://example.com/",
  "127.0.0.1",
  "localhost",
  "example.internal",
  "example.local",
  "example.com:443",
])("rejects an invalid refresh hostname before creating work: %s", async (site) => {
  const t = await setup();
  await t.run();
  const before = await t.records();
  await expect(t.admin.action(api.tasks.siteResearch.refresh, { site })).rejects.toThrow();
  expect(await t.records()).toEqual(before);
  expect(startAgent).not.toHaveBeenCalled();
});

it("uses public origins and a concrete draft-7 schema with all profile fields", () => {
  expect(researchSite("Try (https://example.com/invite?token=abc).")).toBe("example.com");
  expect(researchSite("Read https://example.com/help and https://example.com/pricing")).toBe(
    "example.com",
  );
  for (const text of [
    "Find a calculator",
    "https://127.0.0.1",
    "https://[::1]/",
    "https://localhost:5173",
    "https://example.internal/",
    "https://example.local/",
    "https://u:p@example.com",
    "https://example.com:444/",
    "http://example.com",
    "https://example.com and https://example.org",
  ])
    expect(researchSite(text), text).toBeNull();
  const request = researchRequest("example.com");
  expect(request.urls).toEqual(["https://example.com/"]);
  expect(request.schema.$schema).toContain("draft-07");
  expect(request.schema.required).toEqual(["name", "overview", "facts", "unknowns"]);
  expect(request.schema.properties).not.toHaveProperty("homepageUrl");
  expect(request.schema.properties).toMatchObject({
    name: { type: "string" },
    facts: { type: "array" },
  });
  expect(siteBrief.parse(result.data)).toEqual(result.data);
  for (const source of [
    "javascript:alert(1)",
    "http://example.com/help",
    "https://u:p@example.com/help",
  ]) {
    expect(() =>
      siteBrief.parse({ ...result.data, facts: [{ text: "Bad link", sources: [source] }] }),
    ).toThrow();
  }
});
