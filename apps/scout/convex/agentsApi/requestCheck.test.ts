/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { REQUEST_CHECK_MODEL, requestCheckResult } from "./requestCheckModel";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../agentsApi/${path.slice(2)}`,
      module,
    ]),
  ),
};
const paginationOpts = { numItems: 20, cursor: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { memberId, adminId, scoutId } = await backend.run(async (ctx) => {
    const memberId = await insertTestAccount(ctx, { email: "reviewer@example.test" });
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "test-profile" },
    });
    return { memberId, adminId, scoutId };
  });
  const member = backend.withIdentity({ subject: memberId });
  const admin = backend.withIdentity({ subject: adminId });
  const prompt = "Try https://example.com and tell me whether it works.";
  const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
    scoutId,
    prompt,
    kind: "review",
    visibility: "public",
  });
  const saved = await backend.run((ctx) => ctx.db.query("agentsApiSessions").unique());
  if (!saved) throw new Error("Session not created");
  const sessionId = saved._id;
  const initial = await backend.run((ctx) => ctx.db.query("agentsApiRequestChecks").unique());
  if (!initial) throw new Error("Initial check not created");
  const checkId = initial._id;
  const inspect = () => admin.query(api.agentsApi.sessions.get, { sessionId });
  const inspectCheck = () =>
    admin.query(api.agentsApi.requestChecks.inspect, { sessionId, checkId });
  const check = () => backend.action(internal.agentsApi.requestCheck.run, { checkId });
  const publicFeed = () =>
    backend.query(api.scout.activity.list, { scope: "public", site: null, paginationOpts });
  return {
    backend,
    member,
    admin,
    sessionId,
    threadId,
    scoutId,
    prompt,
    inspect,
    inspectCheck,
    checkId,
    check,
    publicFeed,
  };
}

function response(result: unknown) {
  return Response.json({
    id: "resp-check",
    object: "response",
    model: REQUEST_CHECK_MODEL,
    status: "completed",
    output: [
      {
        id: "msg-check",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(result), annotations: [] }],
      },
    ],
    usage: { input_tokens: 300, output_tokens: 30, input_tokens_details: { cached_tokens: 0 } },
  });
}

it("saves the real call and generated title, then makes an approved review public", async () => {
  const t = await setup();
  const result = { title: "Test Example", decision: { kind: "approved" } };
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const call = new Request(input, init);
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(await call.json()).toMatchObject({
      input: t.prompt,
      model: REQUEST_CHECK_MODEL,
      store: false,
    });
    expect((await t.inspectCheck()).state.kind).toBe("running");
    return response(result);
  });
  vi.stubGlobal("fetch", request);
  expect((await t.publicFeed()).page).toEqual([]);
  expect(await t.backend.query(api.scout.activity.get, { threadId: t.threadId })).toBeNull();
  expect(
    (await t.member.query(api.scout.activity.messages, { threadId: t.threadId, paginationOpts }))
      .page,
  ).toMatchObject([{ role: "user", text: t.prompt }]);
  expect(await t.check()).toBe(true);
  const session = await t.inspect();
  expect(session).toMatchObject({
    title: "Test Example",
    active: true,
    checks: [{ _id: t.checkId, kind: "initial", status: "approved" }],
  });
  const check = await t.inspectCheck();
  expect(check).toMatchObject({
    kind: "initial",
    prompt: t.prompt,
    model: REQUEST_CHECK_MODEL,
    state: {
      kind: "completed",
      result: { kind: "initial", ...result },
      call: { usage: { inputTokens: 300, outputTokens: 30 } },
    },
  });
  if (check.state.kind !== "completed") throw new Error("Expected completed check");
  expect(JSON.parse(check.state.call.request)).toMatchObject({ input: t.prompt });
  expect(JSON.parse(check.state.call.response ?? "null")).toMatchObject({
    id: "resp-check",
  });
  expect(check.cost).toBeCloseTo(0.000096);
  expect(session.checks[0]?.cost).toBe(check.cost);
  expect(session.checks[0]).not.toHaveProperty("state");
  expect((await t.publicFeed()).page).toMatchObject([{ title: "Test Example" }]);
  await expect(
    t.member.query(api.agentsApi.sessions.get, { sessionId: t.sessionId }),
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});

it("runs the rejection through the real workflow without starting the agent or browser", async () => {
  const t = await setup();
  const request = vi.fn<typeof fetch>(async (input, init) => {
    expect(new Request(input, init).url).toBe("https://api.openai.com/v1/responses");
    return response({
      title: "Declined request",
      decision: { kind: "rejected", reason: "This request asks for unauthorized access." },
    });
  });
  vi.stubGlobal("fetch", request);
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await t.inspect()).toMatchObject({
    active: false,
    state: { kind: "failed", error: "This request asks for unauthorized access." },
  });
  expect((await t.inspect()).providerId).toBeUndefined();
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").collect())).toEqual(
    [],
  );
  expect((await t.publicFeed()).page).toEqual([]);
  expect(await t.backend.query(api.scout.activity.get, { threadId: t.threadId })).toBeNull();
  expect(
    (await t.backend.query(api.scout.activity.messages, { threadId: t.threadId, paginationOpts }))
      .page,
  ).toEqual([]);
  expect(
    await t.member.query(api.agentsApi.sessions.controls, { sessionId: t.sessionId }),
  ).toMatchObject({
    canSend: false,
    canStop: false,
    requestCheckMessage: "This request asks for unauthorized access.",
  });
  expect(
    (await t.member.query(api.scout.activity.list, { scope: "mine", site: null, paginationOpts }))
      .page,
  ).toHaveLength(1);
});

it.each([
  {
    name: "invalid decision",
    attempts: 1,
    makeResponse: () => response({ title: "Invalid", decision: { kind: "maybe" } }),
  },
  {
    name: "refusal",
    attempts: 1,
    makeResponse: () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply" }] }],
      }),
  },
  {
    name: "provider error",
    attempts: 4,
    makeResponse: () =>
      Response.json(
        { error: { message: "Unavailable" } },
        { status: 503, headers: { "retry-after-ms": "1" } },
      ),
  },
])("fails closed on $name after $attempts HTTP attempts", async ({ makeResponse, attempts }) => {
  const t = await setup();
  vi.useRealTimers();
  const request = vi.fn<typeof fetch>(async () => makeResponse());
  vi.stubGlobal("fetch", request);
  expect(await t.check()).toBe(false);
  expect(await t.inspect()).toMatchObject({
    active: false,
    checks: [{ kind: "initial", status: "failed" }],
  });
  expect((await t.publicFeed()).page).toEqual([]);
  expect(request).toHaveBeenCalledTimes(attempts);
});

it("keeps a stop made during the call even when its response approves the request", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      await t.member.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
      return response({ title: "Example", decision: { kind: "approved" } });
    }),
  );
  expect(await t.check()).toBe(false);
  expect(await t.inspect()).toMatchObject({
    active: false,
    state: { kind: "stopped" },
    checks: [{ kind: "initial", status: "approved" }],
  });
});

it("cancels before dispatch when stopped before the check begins", async () => {
  const t = await setup();
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  await t.member.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  expect(await t.check()).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await t.inspect()).toMatchObject({
    active: false,
    checks: [{ kind: "initial", status: "cancelled", cost: 0 }],
  });
});

it("requires a reason for rejections and a useful short title", () => {
  expect(
    requestCheckResult.safeParse({ title: "Test", decision: { kind: "rejected" } }).success,
  ).toBe(false);
  expect(requestCheckResult.safeParse({ title: " ", decision: { kind: "approved" } }).success).toBe(
    false,
  );
});

it("rejects browser evidence on an initial check without starting the call", async () => {
  const t = await setup();
  await expect(
    t.backend.mutation(internal.agentsApi.requestChecks.start, {
      checkId: t.checkId,
      startedAt: Date.now(),
      request: "{}",
      evidence: { capturedAt: Date.now(), pages: [] },
    }),
  ).rejects.toThrow("Initial check cannot contain browser evidence");
  expect(await t.inspectCheck()).toMatchObject({
    kind: "initial",
    state: { kind: "pending" },
    cost: 0,
  });
});
