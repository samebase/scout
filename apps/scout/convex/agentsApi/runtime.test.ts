/// <reference types="vite/client" />
import { createFunctionHandle } from "convex/server";
import { convexTest } from "convex-test";
import { tool } from "ai";
import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
import componentSchema from "../components/openaiAgents/schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { runtimeTools } from "./tools";
import { createBrowserHarness } from "../scout/browserTools";
import { closeFirecrawlBrowserSession } from "../scout/lib/firecrawl";

vi.mock("./tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools")>()),
  runtimeTools: vi.fn(),
}));
vi.mock("../scout/lib/firecrawl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scout/lib/firecrawl")>()),
  closeFirecrawlBrowserSession: vi.fn(),
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
const componentModules = import.meta.glob("../components/openaiAgents/**/*.ts");
const runKey = "run-test";

function gate() {
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  vi.mocked(closeFirecrawlBrowserSession).mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const backend = convexTest(schema, modules);
  backend.registerComponent("openaiAgents", componentSchema, componentModules);
  const { sessionId, userId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      active: true,
      state: { kind: "starting" },
      nextSequence: 0,
      usage: null,
      browser: null,
      // @ts-expect-error vWorkflowId validates strings; this fixture exercises callbacks without scheduling a command workflow.
      workflowId: runKey,
    });
    return { sessionId, userId };
  });
  const items: unknown[] = [];
  const inputs: unknown[] = [];
  const subagentTurns: unknown[] = [];
  const provider = {
    status: vi.fn<() => "in_progress" | "requires_action" | "idle" | "failed">(() => "in_progress"),
    calls: vi.fn<() => unknown[]>(() => []),
    items,
    latest: { id: "turn-current", status: "completed", error: null, subagent_id: null },
    subagentTurns,
    beforeRetrieve: vi.fn<() => Promise<void>>(async () => {}),
    beforeItems: vi.fn<() => Promise<void>>(async () => {}),
    beforeInput: vi.fn<() => Promise<void>>(async () => {}),
    inputs,
  };
  const remote = () => ({
    id: "provider-session",
    status: provider.status(),
    error: null,
    required_actions: provider.calls(),
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } },
  });
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/sessions"))
      return Response.json(remote());
    if (request.method === "GET" && url.pathname.endsWith("/sessions/provider-session")) {
      await provider.beforeRetrieve();
      return Response.json(remote());
    }
    if (request.method === "GET" && url.pathname.endsWith("/items")) {
      await provider.beforeItems();
      const cursor = url.searchParams.get("after");
      const index = cursor
        ? provider.items.findIndex(
            (value) => z.object({ id: z.string() }).parse(value).id === cursor,
          ) + 1
        : 0;
      return Response.json({
        data: provider.items.slice(index, index + 50),
        has_more: index + 50 < provider.items.length,
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/turns"))
      return Response.json({ data: [...provider.subagentTurns, provider.latest], has_more: false });
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      const body: unknown = await request.json();
      provider.inputs.push(body);
      await provider.beforeInput();
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected provider request: ${request.method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const execute = vi.fn(async () => ({ done: true }));
  const dispose = vi.fn(async () => {});
  vi.mocked(runtimeTools)
    .mockReset()
    .mockResolvedValue({
      tools: { test_tool: tool({ inputSchema: z.object({}), execute }) },
      browser: createBrowserHarness(),
      dispose,
    });
  const onEvent = await backend.run(() =>
    createFunctionHandle(internal.agentsApi.sessions.onEvent),
  );
  await backend.action(components.openaiAgents.runtime.create, {
    sessionKey: sessionId,
    runKey,
    onEvent,
    model: "gpt-5.6-luna",
    instructions: "Test",
    toolsJson: "[]",
  });
  const owner = backend.withIdentity({ subject: userId });
  const flush = () => backend.finishAllScheduledFunctions(() => vi.runAllTimers(), 100);
  const refresh = async () => {
    await backend.mutation(components.openaiAgents.state.refresh, { sessionKey: sessionId });
    await flush();
  };
  const session = () => backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId });
  const history = async () =>
    (
      await owner.query(api.agentsApi.sessions.listItems, {
        sessionId,
        paginationOpts: { cursor: null, numItems: 100 },
      })
    ).page;
  return {
    backend,
    owner,
    sessionId,
    provider,
    execute,
    dispose,
    fetchMock,
    flush,
    refresh,
    session,
    items: history,
  };
}

function message(id: string, text: string, status = "completed") {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status,
  };
}

const call = {
  type: "function_call",
  call_id: "call-1",
  turn_id: "turn-current",
  name: "test_tool",
  arguments: {},
};

it("returns after input submission and saves completed messages without opening an event stream", async () => {
  const t = await setup();
  t.provider.items.push(message("partial", "Half", "in_progress"), message("done", "Complete"));
  await t.backend.action(components.openaiAgents.runtime.send, {
    sessionKey: t.sessionId,
    runKey,
    message: "Start",
  });
  await t.flush();
  expect((await t.items()).map((item) => item.text)).toEqual(["Complete"]);
  t.provider.items[0] = message("partial", "Finished");
  await t.refresh();
  expect((await t.items()).map((item) => item.text)).toEqual(["Complete", "Finished"]);
  expect(
    t.fetchMock.mock.calls.some(
      ([input, init]) =>
        new Request(input, init).method === "GET" &&
        new Request(input, init).url.endsWith("/events"),
    ),
  ).toBe(false);
});

it("advances past failed tool items while revisiting the next unfinished item", async () => {
  const t = await setup();
  t.provider.items.push(
    message("head", "Before tool"),
    { id: "failed-call", type: "function_call", name: "test_tool", status: "failed" },
    {
      id: "failed-output",
      type: "function_call_output",
      error: "Tool call was cancelled.",
      status: "failed",
    },
    message("tail", "After tool"),
    message("unfinished", "Partial", "in_progress"),
  );
  await t.refresh();
  expect(
    (await t.items()).map(({ providerItemId, complete }) => ({ providerItemId, complete })),
  ).toEqual([
    { providerItemId: "tail", complete: true },
    { providerItemId: "failed-output", complete: true },
    { providerItemId: "failed-call", complete: true },
    { providerItemId: "head", complete: true },
  ]);
  expect(
    await t.backend.query(components.openaiAgents.state.get, { sessionKey: t.sessionId }),
  ).toMatchObject({ itemCursor: "tail" });
  t.provider.items[4] = message("unfinished", "Finished");
  await t.refresh();
  expect(
    await t.backend.query(components.openaiAgents.state.get, { sessionKey: t.sessionId }),
  ).toMatchObject({ itemCursor: "unfinished" });
  expect((await t.items())[0]?.text).toBe("Finished");
});

it("executes a requested tool once and does not spin on a stale required-action snapshot", async () => {
  const t = await setup();
  t.provider.status.mockReturnValue("requires_action");
  t.provider.calls.mockReturnValue([call]);
  await t.refresh();
  await t.refresh();
  expect(t.execute).toHaveBeenCalledTimes(1);
  expect(t.dispose).toHaveBeenCalledTimes(1);
  expect(t.provider.inputs).toHaveLength(1);
  expect(t.provider.inputs[0]).toMatchObject({
    events: [{ type: "agent.session.input.tool_result", call_id: "call-1", success: true }],
  });
});

it("runs two outstanding tools sequentially", async () => {
  const t = await setup();
  t.provider.status.mockReturnValue("requires_action");
  t.provider.calls.mockReturnValue([call, { ...call, call_id: "call-2" }]);
  await t.refresh();
  expect(t.execute).toHaveBeenCalledTimes(2);
  expect(t.provider.inputs).toHaveLength(2);
});

it("pauses for human handoff and resumes by submitting the held tool result", async () => {
  const t = await setup();
  await t.backend.mutation(internal.agentsApi.browsers.open, {
    sessionId: t.sessionId,
    browser: {
      providerSessionId: "browser",
      cdpUrl: "wss://browser",
      interactiveLiveViewUrl: "https://browser/control",
      liveViewUrl: null,
      currentUrl: null,
    },
  });
  t.provider.status.mockReturnValue("requires_action");
  t.provider.calls.mockReturnValue([
    {
      ...call,
      name: "request_browser_handoff",
      arguments: { message: "Please solve the captcha" },
    },
  ]);
  await t.refresh();
  expect((await t.session()).state.kind).toBe("waiting");
  expect(t.provider.inputs).toHaveLength(0);
  await t.backend.mutation(internal.agentsApi.sessions.update, {
    sessionId: t.sessionId,
    state: { kind: "running" },
  });
  await t.backend.action(components.openaiAgents.runtime.submitToolResult, {
    sessionKey: t.sessionId,
    runKey,
    callId: call.call_id,
    turnId: call.turn_id,
    resume: true,
    result: { kind: "success", output: "Control returned" },
  });
  await t.flush();
  expect(t.provider.inputs).toHaveLength(1);
  expect((await t.session()).state.kind).toBe("running");
});

it.each(["completed", "failed", "cancelled"])(
  "uses the turn outcome when the session becomes idle: %s",
  async (status) => {
    const t = await setup();
    t.provider.status.mockReturnValue("idle");
    t.provider.latest.status = status;
    t.provider.items.push(message("final", "Finished"));
    await t.refresh();
    expect((await t.session()).state.kind).toBe(
      status === "completed" ? "idle" : status === "cancelled" ? "stopped" : "failed",
    );
    expect((await t.session()).active).toBe(false);
    expect((await t.items())[0]?.text).toBe("Finished");
    expect((await t.session()).usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
    });
  },
);

it("ignores the previous idle turn after submitting a follow-up", async () => {
  const t = await setup();
  t.provider.status.mockReturnValue("idle");
  await t.backend.action(components.openaiAgents.runtime.send, {
    sessionKey: t.sessionId,
    runKey,
    message: "Continue",
  });
  await t.flush();
  expect((await t.session()).active).toBe(true);
  expect((await t.session()).state.kind).toBe("running");
  t.provider.latest.id = "next-turn";
  await t.refresh();
  expect((await t.session()).state.kind).toBe("idle");
});

it("uses the parent turn outcome when a newer subagent turn succeeded", async () => {
  const t = await setup();
  t.provider.status.mockReturnValue("idle");
  t.provider.latest.status = "failed";
  t.provider.subagentTurns.push({
    id: "child-turn",
    status: "completed",
    error: null,
    subagent_id: "child",
  });
  await t.refresh();
  expect((await t.session()).state.kind).toBe("failed");
});

it("Stop schedules cancellation without waiting for another provider event", async () => {
  const t = await setup();
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await t.flush();
  expect(t.provider.inputs).toContainEqual({ events: [{ type: "agent.session.input.cancel" }] });
  expect((await t.session()).state.kind).toBe("stopped");
  expect((await t.session()).active).toBe(false);
});

it("does not submit a tool result if Stop happens during the tool", async () => {
  const t = await setup();
  t.provider.status.mockReturnValue("requires_action");
  t.provider.calls.mockReturnValue([call]);
  t.execute.mockImplementationOnce(async () => {
    await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
    return { done: true };
  });
  await t.refresh();
  expect(t.provider.inputs).toEqual([{ events: [{ type: "agent.session.input.cancel" }] }]);
  expect((await t.session()).state.kind).toBe("stopped");
});

it("stops a queued tool without executing its side effects", async () => {
  const t = await setup();
  await t.backend.mutation(internal.agentsApi.sessions.onEvent, {
    sessionKey: t.sessionId,
    runKey,
    event: {
      kind: "tool",
      call: { callId: call.call_id, turnId: call.turn_id, name: call.name, argumentsJson: "{}" },
    },
  });
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await t.flush();
  expect((await t.session()).active).toBe(false);
  expect(t.execute).not.toHaveBeenCalled();
});

it("rejects a stale app callback after a newer run has started", async () => {
  const t = await setup();
  await t.backend.mutation(internal.agentsApi.sessions.onEvent, {
    sessionKey: t.sessionId,
    runKey: "older-run",
    event: { kind: "state", state: { kind: "idle" }, usage: null },
  });
  expect((await t.session()).state.kind).toBe("running");
});

it("keeps Refresh authenticated and allows it to recover a missed lifecycle event", async () => {
  const t = await setup();
  await expect(
    t.backend.action(api.agentsApi.runtime.refresh, { sessionId: t.sessionId }),
  ).rejects.toThrow();
  t.provider.status.mockReturnValue("idle");
  await t.owner.action(api.agentsApi.runtime.refresh, { sessionId: t.sessionId });
  await t.flush();
  expect((await t.session()).active).toBe(false);
});

it("processes a lifecycle update arriving during a refresh", async () => {
  const t = await setup();
  const started = gate();
  const response = gate();
  t.provider.beforeItems.mockImplementationOnce(async () => {
    started.release();
    await response.promise;
  });
  await t.backend.mutation(components.openaiAgents.state.refresh, { sessionKey: t.sessionId });
  vi.runAllTimers();
  await started.promise;
  t.provider.status.mockReturnValue("idle");
  await t.backend.mutation(components.openaiAgents.state.refresh, { sessionKey: t.sessionId });
  response.release();
  await t.flush();
  expect((await t.session()).state.kind).toBe("idle");
  expect((await t.session()).active).toBe(false);
});

it("reports a provider refresh failure and releases the Scout after cleanup", async () => {
  const t = await setup();
  for (let attempt = 0; attempt < 4; attempt++)
    t.provider.beforeRetrieve.mockRejectedValueOnce(new Error("Provider unavailable"));
  await t.refresh();
  expect((await t.session()).state).toEqual({ kind: "failed", error: "Connection error." });
  expect((await t.session()).active).toBe(false);
});

it("cancels again when Stop races an acknowledged input request", async () => {
  const t = await setup();
  const started = gate();
  const response = gate();
  t.provider.beforeInput.mockImplementationOnce(async () => {
    started.release();
    await response.promise;
  });
  const sending = t.backend.action(components.openaiAgents.runtime.send, {
    sessionKey: t.sessionId,
    runKey,
    message: "Start",
  });
  await started.promise;
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await t.backend.action(components.openaiAgents.runtime.cancel, { sessionKey: t.sessionId });
  response.release();
  await sending;
  expect(t.provider.inputs).toHaveLength(3);
  expect(t.provider.inputs.slice(1)).toEqual([
    { events: [{ type: "agent.session.input.cancel" }] },
    { events: [{ type: "agent.session.input.cancel" }] },
  ]);
  await t.flush();
  expect((await t.session()).state.kind).toBe("stopped");
});

it("holds the Scout until a stopped tool settles, even if browser cleanup finishes first", async () => {
  const t = await setup();
  const started = gate();
  const result = gate();
  t.provider.status.mockReturnValue("requires_action");
  t.provider.calls.mockReturnValue([call]);
  t.execute.mockImplementationOnce(async () => {
    started.release();
    await result.promise;
    return { done: true };
  });
  const refreshing = t.refresh();
  await started.promise;
  await t.backend.mutation(internal.agentsApi.sessions.onEvent, {
    sessionKey: t.sessionId,
    runKey,
    event: {
      kind: "tool",
      call: { callId: call.call_id, turnId: call.turn_id, name: call.name, argumentsJson: "{}" },
    },
  });
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await t.backend.action(internal.agentsApi.runtime.cleanup, { sessionId: t.sessionId });
  expect((await t.session()).active).toBe(true);
  result.release();
  await refreshing;
  expect((await t.session()).active).toBe(false);
  expect((await t.session()).state.kind).toBe("stopped");
  expect(t.execute).toHaveBeenCalledOnce();
});

it("does not let another admin resume work through Refresh", async () => {
  const t = await setup();
  const otherId = await t.backend.run((ctx) =>
    insertTestAccount(ctx, { email: "nicu@samebase.com" }),
  );
  await expect(
    t.backend
      .withIdentity({ subject: otherId })
      .action(api.agentsApi.runtime.refresh, { sessionId: t.sessionId }),
  ).rejects.toThrow("Only the owner");
});

it("keeps history delivered while a resume check owns the new run key", async () => {
  const t = await setup();
  // Starting a resume workflow updates the app run key before component.prepare runs.
  await t.backend.run(async (ctx) => {
    // @ts-expect-error Same vWorkflowId fixture boundary as setup.
    await ctx.db.patch(t.sessionId, { workflowId: "resume-run", pendingCommand: true });
  });
  t.provider.items.push(message("handoff-message", "Please complete this browser step."));
  await t.refresh();
  expect((await t.items()).map((item) => item.providerItemId)).toEqual(["handoff-message"]);
  expect((await t.session()).pendingCommand).toBe(true);
  const component = await t.backend.query(components.openaiAgents.state.get, {
    sessionKey: t.sessionId,
  });
  if (!component) throw new Error("Missing component session");
  await t.backend.mutation(components.openaiAgents.state.prepare, {
    sessionKey: t.sessionId,
    runKey: "resume-run",
    previousTurnId: null,
    expectedGeneration: component.generation,
  });
  await t.refresh();
  expect((await t.items()).map((item) => item.providerItemId)).toEqual(["handoff-message"]);
});

it.each(["failed", "canceled", "success"] as const)(
  "releases a Scout without replaying a tool whose job ended %s without a result",
  async (kind) => {
    const t = await setup();
    const jobId = await t.backend.run((ctx) =>
      ctx.scheduler.runAfter(0, internal.agentsApi.sessions.saveItems, {
        sessionId: t.sessionId,
        items: [],
      }),
    );
    await t.flush();
    t.provider.status.mockReturnValue("requires_action");
    t.provider.calls.mockReturnValue([call]);
    await t.backend.run(async (ctx) => {
      // @ts-expect-error convex-test's patch syscall permits simulating termination of a completed scheduler fixture.
      await ctx.db.patch<"_scheduled_functions">(jobId, {
        state: kind === "failed" ? { kind, error: "Action timed out" } : { kind },
      });
      await ctx.db.insert("agentsApiCalls", {
        sessionId: t.sessionId,
        callId: call.call_id,
        result: { kind: "running", jobId },
      });
    });
    await t.refresh();
    expect((await t.session()).state).toMatchObject({
      kind: "failed",
      error: expect.stringContaining("side effects may have occurred"),
    });
    await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
    await t.flush();
    const stopped = await t.session();
    expect(stopped.state.kind).toBe("stopped");
    expect(stopped.cleanupComplete).toBe(true);
    expect(stopped.active).toBe(false);
    expect(t.execute).not.toHaveBeenCalled();
    expect(t.provider.inputs).not.toContainEqual(
      expect.objectContaining({
        events: [expect.objectContaining({ type: "agent.session.input.tool_result" })],
      }),
    );
  },
);

it("keeps Stop available when a tool terminates after browser cleanup", async () => {
  const t = await setup();
  const jobId = await t.backend.run((ctx) =>
    ctx.scheduler.runAfter(0, internal.agentsApi.sessions.saveItems, {
      sessionId: t.sessionId,
      items: [],
    }),
  );
  await t.flush();
  await t.backend.run(async (ctx) => {
    // @ts-expect-error convex-test's patch syscall permits simulating a running scheduler fixture.
    await ctx.db.patch<"_scheduled_functions">(jobId, {
      state: { kind: "inProgress" },
    });
    await ctx.db.insert("agentsApiCalls", {
      sessionId: t.sessionId,
      callId: call.call_id,
      result: { kind: "running", jobId },
    });
  });
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  await t.flush();
  expect(await t.session()).toMatchObject({
    active: true,
    cleanupComplete: true,
    state: { kind: "stopped" },
  });
  expect(
    await t.owner.query(api.agentsApi.sessions.controls, { sessionId: t.sessionId }),
  ).toMatchObject({ canStop: true });
  await t.backend.run(async (ctx) => {
    // @ts-expect-error convex-test permits simulating platform termination in its system-table fixture.
    await ctx.db.patch<"_scheduled_functions">(jobId, {
      state: { kind: "failed", error: "Action timed out" },
    });
  });
  await t.owner.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
  expect((await t.session()).active).toBe(false);
  expect(t.execute).not.toHaveBeenCalled();
});
