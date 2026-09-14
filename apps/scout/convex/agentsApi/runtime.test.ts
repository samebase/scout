/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { tool } from "ai";
import { convexTest } from "convex-test";
import type {
  AgentReasoningItem,
  AgentSessionItem,
  TokenUsage,
} from "openai/resources/beta/agents/agents";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { createBrowserHarness } from "../scout/browserTools";
import { closeFirecrawlBrowserSession } from "../scout/lib/firecrawl";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { runtimeTools } from "./tools";

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  vi.mocked(runtimeTools).mockReset();
  vi.mocked(closeFirecrawlBrowserSession).mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const seeded = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "scout", address: "scout@example.test" },
      firecrawl: { profileName: "scout-profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      active: true,
      state: { kind: "running" },
      nextSequence: 0,
      usage: null,
      providerId: "session-test",
      browser: {
        providerSessionId: "browser-test",
        cdpUrl: "wss://browser.example.test/cdp",
        interactiveLiveViewUrl: "https://browser.example.test/live",
        liveViewUrl: null,
        currentUrl: null,
      },
    });
    await ctx.db.insert("agentsApiBrowserSessions", {
      agentsSessionId: sessionId,
      sequence: 1,
      providerSessionId: "browser-test",
      viewport: { width: 1280, height: 800 },
      lifecycle: { kind: "active", openedAtMs: Date.now() },
      nextOperationSequence: 1,
    });
    return { userId, sessionId };
  });
  const items: AgentSessionItem[] = [];
  const events: unknown[] = [];
  const after: Array<string | null> = [];
  const provider = {
    items,
    events,
    after,
    beforeRetrieve: vi.fn<() => Promise<void>>(async () => {}),
    beforeItems: vi.fn<() => Promise<void>>(async () => {}),
    onInput: vi.fn<() => void>(),
    stream: vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
    ),
    usage: vi.fn<() => TokenUsage | null>(() => null),
    status: vi.fn<() => "idle" | "requires_action">(() => "requires_action"),
    turn: vi.fn(() => ({ id: "previous-turn", status: "cancelled" })),
    call: {
      type: "function_call",
      call_id: "call-test",
      turn_id: "turn-test",
      name: "test_tool",
      arguments: {},
    },
  };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test")) {
      await provider.beforeRetrieve();
      return Response.json({
        status: provider.status(),
        usage: provider.usage(),
        required_actions: [provider.call],
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test/turns")) {
      return Response.json({ data: [provider.turn()], has_more: false });
    }
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test/items")) {
      await provider.beforeItems();
      const cursor = url.searchParams.get("after");
      provider.after.push(cursor);
      const start =
        cursor === null ? 0 : provider.items.findIndex((item) => item.id === cursor) + 1;
      const data = provider.items.slice(start, start + 50);
      return Response.json({ data, has_more: start + data.length < provider.items.length });
    }
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test/events")) {
      return new Response(provider.stream(), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/sessions/session-test/events")) {
      const body: unknown = await request.json();
      provider.events.push(body);
      provider.onInput();
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected provider request: ${request.method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const execute = vi.fn(async () => ({ done: true }));
  const dispose = vi.fn(async () => {});
  vi.mocked(runtimeTools).mockResolvedValue({
    tools: { test_tool: tool({ inputSchema: z.object({}), execute }) },
    browser: createBrowserHarness(),
    dispose,
  });
  const owner = backend.withIdentity({ subject: seeded.userId });
  const advance = () =>
    backend.action(internal.agentsApi.runtime.advance, { sessionId: seeded.sessionId });
  const session = () =>
    backend.query(internal.agentsApi.sessions.cleanupResources, { sessionId: seeded.sessionId });
  const history = () =>
    backend.run(async (ctx) =>
      ctx.db
        .query("agentsApiItems")
        .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", seeded.sessionId))
        .take(100),
    );
  const savedCall = () =>
    backend.run(async (ctx) =>
      ctx.db
        .query("agentsApiCalls")
        .withIndex("by_session_id_and_call_id", (q) =>
          q.eq("sessionId", seeded.sessionId).eq("callId", provider.call.call_id),
        )
        .unique(),
    );
  return {
    backend,
    owner,
    ...seeded,
    provider,
    execute,
    dispose,
    advance,
    session,
    history,
    savedCall,
  };
}

function reasoning(id: string, status: "in_progress" | "completed"): AgentReasoningItem {
  return { id, type: "reasoning", status, summary: [], turn_id: "turn-test" };
}

it("executes review site assignment through the real tools without connecting to the browser", async () => {
  const t = await setup();
  await t.backend.run(async (ctx) => {
    const session = await ctx.db.get(t.sessionId);
    if (!session) throw new Error("Session missing");
    await ctx.db.insert("scoutChats", {
      threadId: t.sessionId,
      runtime: { kind: "agents_api", sessionId: t.sessionId },
      userId: t.userId,
      scoutId: session.scoutId,
      createdAt: Date.now(),
      purpose: { kind: "review" },
      visibility: "private",
    });
  });
  const original = await vi.importActual<typeof import("./tools")>("./tools");
  vi.mocked(runtimeTools).mockImplementation(original.runtimeTools);
  t.provider.call.name = "set_review_site";
  t.provider.call.arguments = { site: "samebase.com" };
  expect(await t.advance()).toBe(true);
  expect(await t.savedCall()).toMatchObject({
    result: { kind: "success", output: JSON.stringify({ primarySite: "samebase.com" }) },
  });
  expect(
    await t.backend.run(async (ctx) =>
      ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (q) => q.eq("threadId", t.sessionId))
        .unique(),
    ),
  ).toMatchObject({ primarySite: "samebase.com" });
});

it("subscribes before submitting a tool result and persists live output before history or completion", async () => {
  const { provider, advance, history, session } = await setup();
  vi.useRealTimers();
  let signalInput: () => void = () => {};
  const inputSent = new Promise<void>((resolve) => {
    signalInput = resolve;
  });
  const live = new TransformStream<Uint8Array, Uint8Array>();
  const writer = live.writable.getWriter();
  const emit = (event: AgentSessionEvent) =>
    writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  provider.stream.mockReturnValue(live.readable);
  provider.onInput.mockImplementation(() => {
    expect(provider.stream).toHaveBeenCalledOnce();
    signalInput();
  });
  const running = advance();
  await inputSent;
  const eventBase = {
    event_id: "event",
    session_id: "session-test",
    turn_id: "turn-test",
    output_index: 0,
  };
  await emit({
    ...eventBase,
    item_id: "assistant",
    content_index: 0,
    type: "agent.session.turn.output_text.delta",
    delta: "I am checking the page.",
  });
  await emit({
    ...eventBase,
    item_id: "reasoning",
    summary_index: 0,
    type: "agent.session.turn.reasoning_summary_text.delta",
    delta: "Checking what the controls do.",
  });
  await vi.waitFor(
    async () => {
      expect((await history()).map(({ kind, text }) => ({ kind, text }))).toEqual([
        { kind: "assistant", text: "I am checking the page." },
        { kind: "reasoning", text: "Checking what the controls do." },
      ]);
    },
    { timeout: 3_000 },
  );
  expect((await session()).active).toBe(true);
  expect(provider.items).toEqual([]);
  await emit({
    ...eventBase,
    item_id: "assistant",
    content_index: 0,
    type: "agent.session.turn.output_text.done",
    text: "I checked the page.",
  });
  await writer.close();
  await expect(running).resolves.toBe(true);
  expect((await history())[0].text).toBe("I checked the page.");
});

it("syncs history and usage produced by cancellation while preserving the stopped state", async () => {
  const { backend, provider, owner, sessionId, history, session } = await setup();
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  provider.onInput.mockImplementation(() => {
    provider.items.push({
      ...reasoning("cancelled-reason", "completed"),
      summary: [{ type: "summary_text", text: "Checked the page before cancellation." }],
    });
    provider.usage.mockReturnValue({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 10 },
    });
  });
  await backend.action(internal.agentsApi.runtime.cleanup, { sessionId });
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "stopped" },
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  expect((await history())[0].text).toBe("Checked the page before cancellation.");
});

it("cancels and releases the browser even when recovering history fails", async () => {
  const { backend, provider, owner, sessionId, session } = await setup();
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  provider.beforeItems.mockRejectedValue(new Error("History unavailable"));
  await expect(backend.action(internal.agentsApi.runtime.cleanup, { sessionId })).rejects.toThrow();
  expect(provider.events).toContainEqual({ events: [{ type: "agent.session.input.cancel" }] });
  expect(await session()).toMatchObject({
    active: false,
    browser: null,
    state: { kind: "stopped" },
  });
});

it("restores chronological order when earlier history arrives after a later streamed item", async () => {
  const { backend, provider, owner, sessionId, history } = await setup();
  await backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "later",
        kind: "reasoning",
        text: "streamed",
        details: "{}",
        complete: false,
      },
    ],
  });
  provider.items.push(reasoning("earlier", "completed"), reasoning("later", "completed"));
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    active: false,
    state: { kind: "stopped" },
  });
  await owner.action(api.agentsApi.runtime.refresh, { sessionId });
  await backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    items: [
      {
        providerItemId: "later",
        kind: "reasoning",
        text: "stale delta",
        details: "{}",
        complete: false,
      },
    ],
  });
  expect(
    (await history()).map((item) => ({
      id: item.providerItemId,
      sequence: item.sequence,
      text: item.text,
    })),
  ).toEqual([
    { id: "earlier", sequence: 0, text: "" },
    { id: "later", sequence: 1, text: "" },
  ]);
});

it("places delayed items after the saved cursor during a running turn", async () => {
  const { backend, provider, sessionId, history, advance } = await setup();
  const saved = (providerItemId: string) => ({
    providerItemId,
    kind: "reasoning",
    text: "",
    details: "{}",
    complete: false,
  });
  await backend.mutation(internal.agentsApi.sessions.saveItems, {
    sessionId,
    cursor: "head",
    items: [saved("head"), saved("later")],
  });
  provider.items.push(
    reasoning("head", "completed"),
    reasoning("earlier", "completed"),
    reasoning("later", "completed"),
  );
  await advance();
  expect((await history()).map((item) => item.providerItemId)).toEqual([
    "head",
    "earlier",
    "later",
  ]);
});

it("replaces cumulative usage snapshots and prices cached input without counting reasoning twice", async () => {
  const { provider, advance, session, owner, sessionId } = await setup();
  provider.usage.mockReturnValue({
    input_tokens: 100_000,
    output_tokens: 1_000,
    total_tokens: 101_000,
    input_tokens_details: { cached_tokens: 90_000 },
    output_tokens_details: { reasoning_tokens: 800 },
  });
  await advance();
  await advance();
  expect((await session()).usage).toEqual({
    inputTokens: 100_000,
    outputTokens: 1_000,
    cachedInputTokens: 90_000,
  });
  expect(
    (await owner.query(api.agentsApi.sessions.get, { sessionId })).cost.modelEstimateUsd,
  ).toBeCloseTo(0.005);
  provider.usage.mockReturnValue({
    input_tokens: 200_000,
    output_tokens: 2_000,
    total_tokens: 202_000,
    input_tokens_details: { cached_tokens: 190_000 },
    output_tokens_details: { reasoning_tokens: 1_500 },
  });
  await advance();
  expect((await session()).usage?.inputTokens).toBe(200_000);
  expect(
    (await owner.query(api.agentsApi.sessions.get, { sessionId })).cost.modelEstimateUsd,
  ).toBeCloseTo(0.0082);
});

it("cleans up when Stop wins the handoff transition race", async () => {
  const { backend, owner, sessionId, provider, advance, session } = await setup();
  provider.call.name = "request_browser_handoff";
  provider.call.arguments = { message: "Complete the CAPTCHA" };
  provider.beforeRetrieve.mockImplementationOnce(async () => {
    await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  });
  await expect(advance()).resolves.toBe(true);
  expect(await session()).toMatchObject({ state: { kind: "stopped" }, active: true });
  await expect(advance()).resolves.toBe(false);
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await session()).toMatchObject({
    state: { kind: "stopped" },
    active: false,
    browser: null,
  });
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
  expect(provider.events).toContainEqual({ events: [{ type: "agent.session.input.cancel" }] });
});

it("waits for the follow-up turn instead of finishing against the previous cancelled turn", async () => {
  const { backend, sessionId, provider, advance, session } = await setup();
  provider.status.mockReturnValue("idle");
  await backend.action(internal.agentsApi.runtime.begin, {
    sessionId,
    command: { kind: "send", message: "Next task" },
  });
  expect((await session()).previousTurnId).toBe("previous-turn");
  await expect(advance()).resolves.toBe(true);
  expect(await session()).toMatchObject({ state: { kind: "running" }, active: true });
  expect(closeFirecrawlBrowserSession).not.toHaveBeenCalled();
  provider.status.mockReturnValue("requires_action");
  provider.call.turn_id = "previous-turn";
  await expect(advance()).resolves.toBe(true);
  expect(runtimeTools).not.toHaveBeenCalled();
  provider.status.mockReturnValue("idle");
  provider.turn.mockReturnValue({ id: "new-turn", status: "completed" });
  await expect(advance()).resolves.toBe(false);
  expect(await session()).toMatchObject({ state: { kind: "idle" }, active: false });
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
});

it("refreshes ended-session history and cost without restarting the agent or changing the failure", async () => {
  const { backend, owner, sessionId, provider, execute, session } = await setup();
  await expect(owner.action(api.agentsApi.runtime.refresh, { sessionId })).rejects.toThrow(
    "already being refreshed",
  );
  await backend.run(async (ctx) => {
    await ctx.db.patch(sessionId, {
      active: false,
      state: { kind: "failed", error: "Browser interrupted" },
    });
  });
  provider.usage.mockReturnValue({
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 80 },
    output_tokens_details: { reasoning_tokens: 10 },
  });
  provider.items.push(reasoning("completed-item", "completed"));
  await owner.action(api.agentsApi.runtime.refresh, { sessionId });
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "failed", error: "Browser interrupted" },
    usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20 },
  });
  expect(provider.events).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
  const adminId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  await backend
    .withIdentity({ subject: adminId })
    .action(api.agentsApi.runtime.refresh, { sessionId });
  const strangerId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "member@example.com" }),
  );
  const stranger = backend.withIdentity({ subject: strangerId });
  await expect(stranger.action(api.agentsApi.runtime.refresh, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
});

it.each([
  { race: "the same workflow reactivates", priorWorkflow: true, newWorkflow: false, active: true },
  { race: "a follow-up is active", priorWorkflow: true, newWorkflow: true, active: true },
  { race: "a follow-up has ended", priorWorkflow: true, newWorkflow: true, active: false },
  { race: "the first follow-up has ended", priorWorkflow: false, newWorkflow: true, active: false },
])(
  "discards late Refresh writes when $race during pagination",
  async ({ priorWorkflow, newWorkflow, active }) => {
    const { backend, owner, sessionId, provider, session, history, execute } = await setup();
    await backend.mutation(internal.agentsApi.sessions.update, {
      sessionId,
      active: false,
      state: { kind: "idle" },
    });
    if (priorWorkflow) {
      await owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Previous task" });
      await backend.mutation(internal.agentsApi.sessions.update, { sessionId, active: false });
    }
    const capturedWorkflowId = (await session()).workflowId;
    const currentUsage = { inputTokens: 200, cachedInputTokens: 160, outputTokens: 40 };
    const currentItem = {
      providerItemId: "item-50",
      kind: "reasoning",
      text: "Current transcript",
      details: "Current provider details",
    };
    provider.usage.mockReturnValue({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 10 },
    });
    provider.items.push(
      ...Array.from({ length: 52 }, (_, index) => reasoning(`item-${index}`, "completed")),
    );
    provider.beforeItems.mockImplementationOnce(async () => {});
    provider.beforeItems.mockImplementationOnce(async () => {
      expect(await history()).toHaveLength(50);
      if (newWorkflow)
        await owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" });
      await backend.mutation(internal.agentsApi.sessions.update, {
        sessionId,
        active,
        state: active ? { kind: "running" } : { kind: "idle" },
        usage: currentUsage,
      });
      await backend.mutation(internal.agentsApi.sessions.saveItems, {
        sessionId,
        items: [currentItem, { ...currentItem, providerItemId: "new-item" }],
        cursor: "new-item",
      });
    });

    await owner.action(api.agentsApi.runtime.refresh, { sessionId });

    const currentSession = await session();
    expect(currentSession).toMatchObject({
      active,
      state: { kind: active ? "running" : "idle" },
      usage: currentUsage,
      itemCursor: "new-item",
      nextSequence: 52,
    });
    expect(currentSession.workflowId === capturedWorkflowId).toBe(!newWorkflow);
    const transcript = await history();
    expect(transcript).toHaveLength(52);
    expect(transcript.find((item) => item.providerItemId === "item-50")).toMatchObject(currentItem);
    expect(transcript.some((item) => item.providerItemId === "item-51")).toBe(false);
    expect(provider.after).toEqual([null, "item-49"]);
    expect(provider.events).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  },
);

it("pauses only after the handoff transition actually enters waiting", async () => {
  const { provider, advance, session } = await setup();
  provider.call.name = "request_browser_handoff";
  provider.call.arguments = { message: "Complete the CAPTCHA" };
  await expect(advance()).resolves.toBe(false);
  expect(await session()).toMatchObject({
    state: { kind: "waiting", callId: "call-test" },
    active: true,
  });
  expect(closeFirecrawlBrowserSession).not.toHaveBeenCalled();
});

it("traverses pages past unfinished items, dispatches the tool, and later advances the durable cursor", async () => {
  const { provider, advance, session, history, execute } = await setup();
  provider.items.push(
    ...Array.from({ length: 51 }, (_, index) =>
      reasoning(`item-${index}`, index === 0 ? "in_progress" : "completed"),
    ),
  );
  await expect(advance()).resolves.toBe(true);
  expect(provider.after).toEqual([null, "item-49", null, "item-49"]);
  expect((await session()).itemCursor).toBeUndefined();
  expect((await history()).map((item) => item.providerItemId)).toEqual(
    provider.items.map((item) => item.id),
  );
  expect(execute).toHaveBeenCalledOnce();
  provider.items[0] = reasoning("item-0", "completed");
  await advance();
  expect((await session()).itemCursor).toBe("item-50");
  expect(await history()).toHaveLength(51);
  expect(execute).toHaveBeenCalledOnce();
});

it("keeps delayed assistant preambles ahead of tool calls by waiting for the provider transcript", async () => {
  const { provider, advance, history, savedCall } = await setup();
  await advance();
  expect(await history()).toEqual([]);
  expect((await savedCall())?.result).toEqual({ kind: "success", output: '{"done":true}' });
  provider.items.push(
    {
      id: "preamble",
      type: "message",
      role: "assistant",
      phase: "commentary",
      status: "completed",
      turn_id: "turn-test",
      content: [{ type: "output_text", text: "I will run the tool." }],
    },
    {
      id: "call-item",
      type: "function_call",
      name: "test_tool",
      call_id: "call-test",
      arguments: {},
      status: "completed",
      turn_id: "turn-test",
    },
  );
  await advance();
  expect((await history()).map((item) => item.kind)).toEqual(["assistant", "function_call"]);
});

it("closes the browser even if OpenAI cancellation fails, retaining the Scout lease", async () => {
  const { backend, sessionId, provider, session } = await setup();
  provider.beforeRetrieve.mockRejectedValueOnce(new Error("Cancellation unavailable"));
  const run = () => backend.action(internal.agentsApi.runtime.cleanup, { sessionId });
  await expect(run()).rejects.toThrow("Connection error.");
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
  expect(await session()).toMatchObject({ active: true, browser: null });
  await run();
  expect((await session()).active).toBe(false);
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
});

it("retries failed cleanup only on Stop, deduplicates pending/running jobs, and clears the job before the next send", async () => {
  const { backend, owner, sessionId, provider, session } = await setup();
  await backend.mutation(internal.agentsApi.sessions.update, {
    sessionId,
    state: { kind: "failed", error: "Run failed" },
  });
  await backend.mutation(internal.agentsApi.sessions.scheduleCleanup, { sessionId });
  const firstJobId = (await session()).cleanupJobId;
  if (!firstJobId) throw new Error("Cleanup was not scheduled");
  provider.beforeRetrieve.mockRejectedValueOnce(new Error("Cancellation unavailable"));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await backend.finishAllScheduledFunctions(vi.runAllTimers);
    expect(errorLog).toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
  expect((await backend.run((ctx) => ctx.db.system.get(firstJobId)))?.state.kind).toBe("failed");
  expect(await session()).toMatchObject({ active: true, browser: null });
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  const retryJobId = (await session()).cleanupJobId;
  if (!retryJobId) throw new Error("Cleanup retry was not scheduled");
  expect(retryJobId).not.toBe(firstJobId);
  await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
  expect((await session()).cleanupJobId).toBe(retryJobId);
  provider.beforeRetrieve.mockImplementationOnce(async () => {
    expect((await backend.run((ctx) => ctx.db.system.get(retryJobId)))?.state.kind).toBe(
      "inProgress",
    );
    await owner.mutation(api.agentsApi.sessions.stop, { sessionId });
    expect((await session()).cleanupJobId).toBe(retryJobId);
    await expect(
      owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" }),
    ).rejects.toThrow("Stop the current run");
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await session()).active).toBe(false);
  expect((await backend.run((ctx) => ctx.db.system.get(retryJobId)))?.state.kind).toBe("success");
  await owner.mutation(api.agentsApi.sessions.send, { sessionId, message: "Next task" });
  expect((await session()).cleanupJobId).toBeUndefined();
  expect(provider.beforeRetrieve).toHaveBeenCalledTimes(3);
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
});

it("persists connection errors as tool results and does not rerun an already claimed call", async () => {
  const { provider, advance, execute, dispose, savedCall } = await setup();
  vi.mocked(runtimeTools).mockRejectedValueOnce(new Error("CDP connection failed"));
  await expect(advance()).resolves.toBe(true);
  expect((await savedCall())?.result).toEqual({ kind: "error", error: "CDP connection failed" });
  expect(provider.events).toContainEqual({
    events: [
      {
        type: "agent.session.input.tool_result",
        turn_id: "turn-test",
        call_id: "call-test",
        success: false,
        error: "CDP connection failed",
      },
    ],
  });
  await advance();
  expect(runtimeTools).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
});

it("saves successful side effects before disposal and never repeats them after disposal fails", async () => {
  const { advance, execute, dispose, savedCall } = await setup();
  dispose.mockRejectedValueOnce(new Error("Disconnect failed"));
  await expect(advance()).rejects.toThrow("Disconnect failed");
  expect((await savedCall())?.result).toEqual({ kind: "success", output: '{"done":true}' });
  await expect(advance()).resolves.toBe(true);
  expect(execute).toHaveBeenCalledOnce();
  expect(runtimeTools).toHaveBeenCalledOnce();
});

it("refuses to replay an interrupted call whose side-effect outcome is unknown", async () => {
  const { backend, sessionId, provider, advance, execute } = await setup();
  await backend.mutation(internal.agentsApi.sessions.claimCall, {
    sessionId,
    callId: provider.call.call_id,
  });
  await expect(advance()).rejects.toThrow("Tool execution was interrupted");
  expect(execute).not.toHaveBeenCalled();
  expect(runtimeTools).not.toHaveBeenCalled();
  expect(provider.events).toEqual([]);
});
