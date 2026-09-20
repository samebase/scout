/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import workflowTest from "@convex-dev/workflow/test";
import { tool } from "ai";
import { convexTest } from "convex-test";
import type {
  AgentReasoningItem,
  AgentSessionInputMessageParam,
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
import { workflow } from "./lifecycle";
import { presentItem } from "./output";
import { followUpContext, previousWalkthroughContext } from "./instructions";

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
      `../tasks/${path.slice(2)}`,
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
  vi.restoreAllMocks();
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
  const inputKeys: Array<string | null> = [];
  const after: Array<string | null> = [];
  const provider = {
    items,
    events,
    inputKeys,
    after,
    beforeRetrieve: vi.fn<() => Promise<void>>(async () => {}),
    httpFailure: vi.fn<() => Response | null>(() => null),
    beforeItems: vi.fn<() => Promise<void>>(async () => {}),
    onInput: vi.fn<() => void>(),
    inputFailure: vi.fn<() => Response | null>(() => null),
    stream: vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
    ),
    usage: vi.fn<() => TokenUsage | null>(() => null),
    status: vi.fn<() => "idle" | "requires_action" | "failed">(() => "requires_action"),
    turn: vi.fn<
      () => {
        id: string;
        status: "cancelled" | "completed" | "failed";
        subagent_id: string | null;
        usage: TokenUsage | null;
      }
    >(() => ({ id: "previous-turn", status: "cancelled", subagent_id: null, usage: null })),
    call: {
      type: "function_call",
      call_id: "call-test",
      turn_id: "turn-test",
      name: "test_tool",
      arguments: {},
    },
  };
  const turns = vi.fn(() => [provider.turn()]);
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test")) {
      await provider.beforeRetrieve();
      const failure = provider.httpFailure();
      if (failure) return failure;
      return Response.json({
        status: provider.status(),
        usage: provider.usage(),
        required_actions: [provider.call],
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/sessions/session-test/turns")) {
      return Response.json({ data: turns(), has_more: false });
    }
    if (request.method === "GET" && url.pathname.includes("/sessions/session-test/turns/")) {
      const turn = turns().find((entry) => entry.id === url.pathname.split("/").at(-1));
      if (!turn) throw new Error("Provider turn not found");
      return Response.json(turn);
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
      provider.inputKeys.push(request.headers.get("Idempotency-Key"));
      const failure = provider.inputFailure();
      if (failure) return failure;
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
    backend.action(internal.tasks.runtime.advance, { sessionId: seeded.sessionId });
  const session = () =>
    backend.query(internal.tasks.sessions.cleanupResources, { sessionId: seeded.sessionId });
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
    turns,
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

function barrier() {
  const resolve = vi.fn<() => void>();
  const promise = new Promise<void>((proceed) => resolve.mockImplementation(proceed));
  return { promise, resolve };
}

const paidUsage: TokenUsage = {
  input_tokens: 80,
  output_tokens: 20,
  total_tokens: 100,
  input_tokens_details: { cached_tokens: 64 },
  output_tokens_details: { reasoning_tokens: 0 },
};

it("retries a completed tool result with one identity and never reruns the tool", async () => {
  vi.useRealTimers();
  const t = await setup();
  t.provider.inputFailure.mockReturnValueOnce(
    Response.json(
      { error: { code: "internal_error", message: "An internal error occurred." } },
      { status: 500, headers: { "retry-after-ms": "1", "x-request-id": "req-tool-result" } },
    ),
  );
  await expect(t.advance()).resolves.toBe(true);
  // A later action may still read the same pending call before the provider updates it.
  await expect(t.advance()).resolves.toBe(true);
  expect(t.execute).toHaveBeenCalledOnce();
  expect(t.provider.events).toHaveLength(3);
  expect(t.provider.events[1]).toEqual(t.provider.events[0]);
  expect(t.provider.events[2]).toEqual(t.provider.events[0]);
  expect(t.provider.inputKeys).toEqual(Array(3).fill(`${t.sessionId}:turn-test:call-test`));
  expect((await t.savedCall())?.result).toEqual({ kind: "success", output: '{"done":true}' });
  expect((await t.session()).state.kind).toBe("running");
});

it("does not create duplicate sessions after an ambiguous creation failure", async () => {
  const t = await setup();
  const checkId = await t.backend.run(async (ctx) => {
    await ctx.db.patch(t.sessionId, { providerId: undefined, browser: null });
    return ctx.db.insert("agentsApiRequestChecks", {
      sessionId: t.sessionId,
      model: "gpt-5.6-luna",
      prompt: "Check example.com",
      kind: "initial",
      state: { kind: "pending" },
    });
  });
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { message: "Server error" } }, { status: 500 }),
  );
  vi.stubGlobal("fetch", request);
  await expect(
    t.backend.action(internal.tasks.runtime.begin, {
      sessionId: t.sessionId,
      command: { kind: "start", prompt: "Check example.com", checkId },
    }),
  ).rejects.toThrow("Server error");
  expect(request).toHaveBeenCalledOnce();
});

it.each(["start", "observe"] as const)(
  "logs an API error delivered inside the successful %s stream response",
  async (phase) => {
    const t = await setup();
    const message = "MCP server 'managed-agents-functions' requires authentication.";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = () =>
      new Response(
        `data: ${JSON.stringify({ type: "error", error: { code: "authentication_error", message } })}\n\n`,
        {
          status: phase === "start" ? 201 : 200,
          headers: { "Content-Type": "text/event-stream", "x-request-id": "req-stream-error" },
        },
      );
    if (phase === "start") {
      const checkId = await t.backend.run(async (ctx) => {
        await ctx.db.patch(t.sessionId, { providerId: undefined, browser: null });
        return ctx.db.insert("agentsApiRequestChecks", {
          sessionId: t.sessionId,
          model: "gpt-5.6-luna",
          prompt: "Check example.com",
          kind: "initial",
          state: { kind: "pending" },
        });
      });
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => response()),
      );
      await expect(
        t.backend.action(internal.tasks.runtime.begin, {
          sessionId: t.sessionId,
          command: { kind: "start", prompt: "Check example.com", checkId },
        }),
      ).rejects.toThrow(message);
    } else {
      const fetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const request = new Request(input, init);
          return request.method === "GET" && new URL(request.url).pathname.endsWith("/events")
            ? response()
            : fetch(input, init);
        }),
      );
      await expect(t.advance()).rejects.toThrow(message);
    }
    expect(log).toHaveBeenCalledWith(
      "OpenAI event stream failed",
      expect.objectContaining({
        sessionId: t.sessionId,
        method: phase === "start" ? "POST" : "GET",
        path: phase === "start" ? "/v1/agents/sessions" : "/v1/agents/sessions/session-test/events",
        diagnostic: expect.objectContaining({
          message,
          providerCode: "authentication_error",
          requestId: "req-stream-error",
        }),
      }),
    );
    expect((await t.session()).state).toMatchObject({ kind: "failed", diagnostic: { message } });
  },
);

it("records HTTP diagnostics with fresh delivery status while redacting the pending message", async () => {
  const t = await setup();
  const workflowId = await t.backend.run(async (ctx) => {
    const id = await workflow.start(
      ctx,
      internal.tasks.lifecycle.run,
      { sessionId: t.sessionId, command: { kind: "observe" } },
      {
        startAsync: true,
        onComplete: internal.tasks.lifecycle.onComplete,
        context: { sessionId: t.sessionId },
      },
    );
    await ctx.db.patch(t.sessionId, {
      workflowId: id,
      pendingMessage: { message: "private pending message", workflowId: id, status: "queued" },
    });
    return id;
  });
  t.provider.beforeRetrieve.mockImplementation(async () => {
    await t.backend.run((ctx) =>
      ctx.db.patch(t.sessionId, {
        pendingMessage: {
          message: "private pending message",
          workflowId,
          status: "submitting",
        },
      }),
    );
  });
  t.provider.httpFailure.mockReturnValue(
    Response.json(
      { error: { code: "authentication_error", message: "private response body" } },
      {
        status: 401,
        headers: { "x-request-id": "req-runtime", cookie: "private-cookie" },
      },
    ),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(t.advance()).rejects.toThrow("private response body");
  expect((await t.session()).state).toMatchObject({
    kind: "failed",
    error: expect.stringContaining("private response body"),
    diagnostic: {
      category: "configuration",
      operation: "advance",
      provider: "openai",
      httpStatus: 401,
      providerCode: "authentication_error",
      requestId: "req-runtime",
    },
  });
  const safeLog = JSON.stringify(log.mock.calls);
  expect(safeLog).toContain('"deliveryStatus":"submitting"');
  expect(safeLog).toContain('"providerSessionId":"session-test"');
  expect(safeLog).not.toContain("private pending message");
  expect(safeLog).toContain("private response body");
  expect(safeLog).not.toContain("private-cookie");
});

it.each(["idle", "failed"] as const)(
  "captures and bills a failed root turn polled from a %s session without a stream turn event",
  async (status) => {
    vi.stubEnv("CREDITS_ENABLED", "true");
    const t = await setup();
    await t.backend.mutation(internal.credits.grantOnSignIn, { userId: t.userId });
    await t.backend.run((ctx) =>
      ctx.db.patch(t.sessionId, {
        billingEnabled: true,
        previousTurnId: "previous-turn",
        browser: null,
      }),
    );
    t.provider.status.mockReturnValue(status);
    t.provider.usage.mockReturnValue(paidUsage);
    t.provider.turn.mockReturnValue({
      id: "failed-turn",
      status: "failed",
      subagent_id: null,
      usage: paidUsage,
    });
    expect((await t.session()).modelTurnId).toBeUndefined();
    await expect(t.advance()).rejects.toThrow();
    expect((await t.session()).modelTurnId).toBe("failed-turn");
    expect(t.provider.stream).not.toHaveBeenCalled();

    // The workflow failure callback preserves the error and schedules this cleanup.
    await t.backend.run((ctx) =>
      ctx.db.patch(t.sessionId, { state: { kind: "failed", error: "Provider turn failed" } }),
    );
    await t.backend.action(internal.tasks.runtime.cleanup, { sessionId: t.sessionId });
    await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.session()).toMatchObject({
      active: false,
      state: { kind: "failed", error: "Provider turn failed" },
      modelUsageIncomplete: false,
    });
    expect(await t.owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 499_971 });
    const charges = await t.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect());
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      sourceKey: "agents:session-test:failed-turn:model",
      totalCostMicrodollars: 29,
    });
  },
);

it("reports a failed session without attributing its previous turn to new work", async () => {
  const t = await setup();
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, { billingEnabled: true, previousTurnId: "previous-turn" }),
  );
  t.provider.status.mockReturnValue("failed");
  await expect(t.advance()).rejects.toThrow("OpenAI session failed");
  expect((await t.session()).modelTurnId).toBeUndefined();
});

it.each([true, false])(
  "bills a captured late turn once after a follow-up starts (paid follow-up: %s)",
  async (nextPaid) => {
    vi.stubEnv("CREDITS_ENABLED", "true");
    const t = await setup();
    await t.backend.mutation(internal.credits.grantOnSignIn, { userId: t.userId });
    await t.backend.run((ctx) =>
      ctx.db.patch(t.sessionId, { billingEnabled: true, browser: null }),
    );
    t.provider.status.mockReturnValue("idle");
    t.provider.turn.mockReturnValue({
      id: "paid-turn",
      status: "completed",
      subagent_id: null,
      usage: null,
    });
    expect(await t.advance()).toBe(false);
    const billing = {
      userId: t.userId,
      providerId: "session-test",
      model: "gpt-5.6-luna",
      turnId: "paid-turn",
    };
    const jobs = await t.backend.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.find((job) => job.name === "tasks/agentsApi:refreshUsage")?.args).toEqual([
      { sessionId: t.sessionId, workflowId: null, attempt: 0, billing },
    ]);
    await t.backend.action(internal.tasks.agentsApi.refreshUsage, {
      sessionId: t.sessionId,
      workflowId: null,
      attempt: 0,
      billing,
    });
    vi.stubEnv("CREDITS_ENABLED", nextPaid ? "true" : "false");
    await t.owner.mutation(api.tasks.sessions.send, {
      sessionId: t.sessionId,
      message: "Continue before old usage arrives",
    });
    t.turns.mockReturnValue([
      {
        id: "new-turn",
        status: "completed",
        subagent_id: null,
        usage: { ...paidUsage, output_tokens: 100_000 },
      },
      { id: "paid-turn", status: "completed", subagent_id: null, usage: paidUsage },
      { id: "old-free-turn", status: "completed", subagent_id: null, usage: paidUsage },
    ]);
    t.provider.items.push(
      {
        id: "old-free-search",
        type: "web_search_call",
        turn_id: "old-free-turn",
        status: "completed",
        action: null,
      },
      {
        id: "new-search",
        type: "web_search_call",
        turn_id: "new-turn",
        status: "completed",
        action: null,
      },
    );
    await t.backend.run(async (ctx) => {
      const wallet = await ctx.db
        .query("creditWallets")
        .withIndex("by_user_id", (q) => q.eq("userId", t.userId))
        .unique();
      if (!wallet) throw new Error("Missing wallet");
      await ctx.db.patch(wallet._id, { balanceUnits: 1 });
    });
    for (let i = 0; i < 2; i++)
      await t.backend.action(internal.tasks.agentsApi.refreshUsage, {
        sessionId: t.sessionId,
        workflowId: null,
        attempt: 2,
        billing,
      });
    expect(await t.owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: -28 });
    const charges = await t.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect());
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: "model", totalCostMicrodollars: 29 });
    expect(await t.session()).toMatchObject({ active: true, billingEnabled: nextPaid });
    expect((await t.session()).modelTurnId).toBeUndefined();
  },
);

it("leaves missing cached usage visible and prices only searches belonging to the paid turn", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const t = await setup();
  await t.backend.mutation(internal.credits.grantOnSignIn, { userId: t.userId });
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, {
      active: false,
      state: { kind: "idle" },
      billingEnabled: true,
      modelTurnId: "paid-turn",
    }),
  );
  t.provider.usage.mockReturnValue(paidUsage);
  t.provider.turn.mockReturnValue({
    id: "paid-turn",
    status: "completed",
    subagent_id: null,
    // @ts-expect-error The provider can omit cache details despite the SDK's required field.
    usage: { ...paidUsage, input_tokens_details: null },
  });
  t.provider.items.push(
    {
      id: "paid-search",
      type: "web_search_call",
      turn_id: "paid-turn",
      status: "completed",
      action: null,
    },
    {
      id: "late-free-search",
      type: "web_search_call",
      turn_id: "old-free-turn",
      status: "completed",
      action: null,
    },
  );
  const billing = {
    userId: t.userId,
    providerId: "session-test",
    model: "gpt-5.6-luna",
    turnId: "paid-turn",
  };
  await expect(
    t.backend.action(internal.tasks.agentsApi.refreshUsage, {
      sessionId: t.sessionId,
      workflowId: null,
      attempt: 2,
      billing,
    }),
  ).rejects.toThrow("usage is still unavailable");
  expect((await t.session()).modelUsageIncomplete).toBe(true);
  expect(await t.owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 490_000 });
  t.provider.turn.mockReturnValue({
    id: "paid-turn",
    status: "completed",
    subagent_id: null,
    usage: paidUsage,
  });
  await t.owner.action(api.tasks.runtime.refresh, { sessionId: t.sessionId });
  await t.owner.action(api.tasks.runtime.refresh, { sessionId: t.sessionId });
  expect(await t.owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 489_971 });
  expect((await t.session()).modelUsageIncomplete).toBe(false);
});

it("cleanup never guesses that the preceding free turn belongs to failed paid work", async () => {
  const t = await setup();
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, {
      billingEnabled: true,
      modelTurnId: undefined,
      previousTurnId: "even-older-turn",
      state: { kind: "failed", error: "Admission failed before submitting input" },
    }),
  );
  t.provider.status.mockReturnValue("idle");
  t.provider.usage.mockReturnValue(paidUsage);
  t.provider.turn.mockReturnValue({
    id: "previous-free-turn",
    status: "completed",
    subagent_id: null,
    usage: paidUsage,
  });
  await t.backend.action(internal.tasks.runtime.cleanup, { sessionId: t.sessionId });
  expect((await t.session()).modelUsageIncomplete).toBe(true);
  expect(await t.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect())).toEqual([]);
  expect(t.turns).not.toHaveBeenCalled();
});

it("never bills an unmarked free turn when credits are enabled later", async () => {
  const t = await setup();
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, { active: false, modelTurnId: "free-turn" }),
  );
  vi.stubEnv("CREDITS_ENABLED", "true");
  t.provider.usage.mockReturnValue(paidUsage);
  await t.owner.action(api.tasks.runtime.refresh, { sessionId: t.sessionId });
  expect(await t.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect())).toEqual([]);
});

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
  expect(t.turns).not.toHaveBeenCalled();
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
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
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
  await backend.action(internal.tasks.runtime.cleanup, { sessionId });
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "stopped" },
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  expect((await history())[0].text).toBe("Checked the page before cancellation.");
});

it("cancels and releases the browser even when recovering history fails", async () => {
  const { backend, provider, owner, sessionId, session } = await setup();
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  provider.beforeItems.mockRejectedValue(new Error("History unavailable"));
  const cleanup = expect(
    backend.action(internal.tasks.runtime.cleanup, { sessionId }),
  ).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10_000);
  await cleanup;
  expect(provider.events).toContainEqual({ events: [{ type: "agent.session.input.cancel" }] });
  expect(await session()).toMatchObject({
    active: false,
    browser: null,
    state: { kind: "stopped" },
  });
});

it("restores chronological order when earlier history arrives after a later streamed item", async () => {
  const { backend, provider, owner, sessionId, history } = await setup();
  await backend.mutation(internal.tasks.sessions.saveItems, {
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
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    active: false,
    state: { kind: "stopped" },
  });
  await owner.action(api.tasks.runtime.refresh, { sessionId });
  await backend.mutation(internal.tasks.sessions.saveItems, {
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
  await backend.mutation(internal.tasks.sessions.saveItems, {
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
    (await owner.query(api.tasks.sessions.get, { sessionId })).cost.modelEstimateUsd,
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
    (await owner.query(api.tasks.sessions.get, { sessionId })).cost.modelEstimateUsd,
  ).toBeCloseTo(0.0082);
});

it("cleans up when Stop wins the handoff transition race", async () => {
  const { backend, owner, sessionId, provider, advance, session } = await setup();
  provider.call.name = "request_browser_handoff";
  provider.call.arguments = { message: "Complete the CAPTCHA" };
  provider.beforeRetrieve.mockImplementationOnce(async () => {
    await owner.mutation(api.tasks.sessions.stop, { sessionId });
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
  await backend.action(internal.tasks.runtime.begin, {
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
  provider.turn.mockReturnValue({
    id: "new-turn",
    status: "completed",
    subagent_id: null,
    usage: null,
  });
  await expect(advance()).resolves.toBe(false);
  expect(await session()).toMatchObject({ state: { kind: "idle" }, active: false });
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
});

it("refreshes the screenshot allowance beside the previous walkthrough without changing the visible message", async () => {
  const { backend, sessionId, provider } = await setup();
  const walkthrough = {
    summary: "No new screenshot was available because the task reached its screenshot limit.",
    sections: [],
  };
  await backend.run((ctx) => ctx.db.patch(sessionId, { walkthrough }));
  const stored = await backend.run((ctx) => ctx.db.get(sessionId));
  const message = "Also add two activities.\n\nKeep  these exact spaces.";
  await backend.action(internal.tasks.runtime.begin, {
    sessionId,
    command: { kind: "send", message },
  });
  const content = [
    { type: "input_text", text: message },
    { type: "input_text", text: followUpContext(stored?.walkthrough) },
  ] satisfies AgentSessionInputMessageParam["content"];
  expect(provider.events).toEqual([
    { events: [{ type: "agent.session.input.message", input: [{ role: "user", content }] }] },
  ]);
  expect(content[1]?.text).toContain("fresh allowance of 20 screenshot attempts");
  expect(content[1]?.text).toContain("Screenshot-limit errors from earlier requests do not apply");
  expect(content[1]?.text).toContain(walkthrough.summary);
  const echoed: AgentSessionItem = {
    id: "follow-up-item",
    type: "message",
    role: "user",
    phase: null,
    status: "completed",
    turn_id: "follow-up-turn",
    content,
  };
  expect(presentItem(echoed).text).toBe(message);
  expect(presentItem(echoed).details).toBe(JSON.stringify(echoed, null, 2));
  expect(
    presentItem({
      ...echoed,
      content: [content[0], { type: "input_text", text: previousWalkthroughContext(walkthrough) }],
    }).text,
  ).toBe(message);
  expect(presentItem({ ...echoed, content: content.slice(1) }).text).toBe(content[1]?.text);
  expect(presentItem({ ...echoed, role: "assistant" }).text).toBe(
    content.map((part) => part.text).join("\n"),
  );
  expect(
    presentItem({
      ...echoed,
      content: [content[0], { type: "input_text", text: "More user text" }],
    }).text,
  ).toBe(`${message}\nMore user text`);
});

it("sends a fresh screenshot allowance even when no walkthrough was saved", async () => {
  const { backend, sessionId, provider } = await setup();
  await backend.action(internal.tasks.runtime.begin, {
    sessionId,
    command: { kind: "send", message: "Try again." },
  });
  expect(provider.events).toEqual([
    {
      events: [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "Try again." },
                { type: "input_text", text: followUpContext(undefined) },
              ],
            },
          ],
        },
      ],
    },
  ]);
  expect(followUpContext(undefined)).toContain("fresh allowance of 20 screenshot attempts");
});

it("refreshes ended-session history and cost without restarting the agent or changing the failure", async () => {
  const { backend, owner, sessionId, provider, execute, session } = await setup();
  await expect(owner.action(api.tasks.runtime.refresh, { sessionId })).rejects.toThrow(
    "already being refreshed",
  );
  await backend.run(async (ctx) => {
    await ctx.db.patch(sessionId, {
      active: false,
      state: { kind: "failed", error: "Browser interrupted" },
      modelUsageIncomplete: true,
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
  await owner.action(api.tasks.runtime.refresh, { sessionId });
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "failed", error: "Browser interrupted" },
    usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20 },
    modelUsageIncomplete: false,
  });
  expect(provider.events).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
  const adminId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  await backend.withIdentity({ subject: adminId }).action(api.tasks.runtime.refresh, { sessionId });
  const strangerId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "member@example.com" }),
  );
  const stranger = backend.withIdentity({ subject: strangerId });
  await expect(stranger.action(api.tasks.runtime.refresh, { sessionId })).rejects.toThrow(
    "Not authorized",
  );
});

it("fetches late usage after completion and replaces revised cumulative totals", async () => {
  const { backend, sessionId, provider, advance, session, owner } = await setup();
  provider.status.mockReturnValue("idle");
  provider.turn.mockReturnValue({
    id: "completed-turn",
    status: "completed",
    subagent_id: null,
    usage: null,
  });
  provider.usage
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 0 },
    })
    .mockReturnValue({
      input_tokens: 300,
      output_tokens: 60,
      total_tokens: 360,
      input_tokens_details: { cached_tokens: 240 },
      output_tokens_details: { reasoning_tokens: 0 },
    });

  await expect(advance()).resolves.toBe(false);
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "idle" },
    usage: null,
    modelUsageIncomplete: true,
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.usage).toHaveBeenCalledTimes(4);
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "idle" },
    usage: { inputTokens: 300, cachedInputTokens: 240, outputTokens: 60 },
    modelUsageIncomplete: false,
  });
  const { cost } = await owner.query(api.tasks.sessions.cost, { sessionId });
  expect(cost.modelEstimateUsd).toBeCloseTo(0.0000888);
  expect(cost.missing).not.toContain("model_usage");
  expect(provider.events).toEqual([]);
});

it("bounds missing-usage checks and leaves an inspectable failure without erasing known usage", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { backend, sessionId, provider, advance, session } = await setup();
  provider.status.mockReturnValue("idle");
  provider.turn.mockReturnValue({
    id: "completed-turn",
    status: "completed",
    subagent_id: null,
    usage: null,
  });
  provider.usage.mockReturnValueOnce({
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 80 },
    output_tokens_details: { reasoning_tokens: 0 },
  });
  await advance();
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.usage).toHaveBeenCalledTimes(4);
  expect(await session()).toMatchObject({
    active: false,
    state: { kind: "idle" },
    usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20 },
    modelUsageIncomplete: true,
  });
  const jobs = await backend.run((ctx) => ctx.db.system.query("_scheduled_functions").take(20));
  expect(jobs.filter((job) => job.state.kind === "failed")).toHaveLength(1);
  expect(errors).toHaveBeenCalledWith(
    "Error when running scheduled function tasks/agentsApi:refreshUsage",
    expect.objectContaining({
      message: expect.stringContaining("OpenAI usage is still unavailable after three checks"),
    }),
  );
  expect(jobs.some((job) => job.state.kind === "pending")).toBe(false);
  // Reapplying the ended state must not start another chain.
  await backend.mutation(internal.tasks.sessions.update, { sessionId, active: false });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(provider.usage).toHaveBeenCalledTimes(4);
  errors.mockRestore();
});

it.each([true, false])(
  "discards a late usage response after a newer turn starts (active: %s)",
  async (active) => {
    const { backend, sessionId, provider, session, owner } = await setup();
    await backend.run((ctx) => ctx.db.patch(sessionId, { active: false, state: { kind: "idle" } }));
    const nextUsage = { inputTokens: 500, cachedInputTokens: 400, outputTokens: 100 };
    provider.beforeRetrieve.mockImplementationOnce(async () => {
      await owner.mutation(api.tasks.sessions.send, {
        sessionId,
        message: "Follow-up task",
      });
      await backend.run((ctx) =>
        ctx.db.patch(sessionId, {
          active,
          usage: nextUsage,
          modelUsageIncomplete: true,
        }),
      );
    });
    provider.usage.mockReturnValue({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
    await backend.action(internal.tasks.agentsApi.refreshUsage, {
      sessionId,
      workflowId: null,
      attempt: 2,
    });
    expect(await session()).toMatchObject({ usage: nextUsage, modelUsageIncomplete: true });
    provider.beforeRetrieve.mockClear();
    await backend.action(internal.tasks.agentsApi.refreshUsage, {
      sessionId,
      workflowId: null,
      attempt: 2,
    });
    expect(provider.beforeRetrieve).not.toHaveBeenCalled();
  },
);

it.each([
  { race: "the same workflow reactivates", priorWorkflow: true, newWorkflow: false, active: true },
  { race: "a follow-up is active", priorWorkflow: true, newWorkflow: true, active: true },
  { race: "a follow-up has ended", priorWorkflow: true, newWorkflow: true, active: false },
  { race: "the first follow-up has ended", priorWorkflow: false, newWorkflow: true, active: false },
])(
  "discards late Refresh writes when $race during pagination",
  async ({ priorWorkflow, newWorkflow, active }) => {
    const { backend, owner, sessionId, provider, session, history, execute } = await setup();
    await backend.mutation(internal.tasks.sessions.update, {
      sessionId,
      active: false,
      state: { kind: "idle" },
    });
    if (priorWorkflow) {
      await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Previous task" });
      await backend.mutation(internal.tasks.sessions.update, { sessionId, active: false });
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
        await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" });
      await backend.mutation(internal.tasks.sessions.update, {
        sessionId,
        active,
        state: active ? { kind: "running" } : { kind: "idle" },
        usage: currentUsage,
      });
      await backend.mutation(internal.tasks.sessions.saveItems, {
        sessionId,
        items: [currentItem, { ...currentItem, providerItemId: "new-item" }],
        cursor: "new-item",
      });
    });

    await owner.action(api.tasks.runtime.refresh, { sessionId });

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

it.each([
  { phase: "stream", outcome: "success" },
  { phase: "submission", outcome: "success" },
  { phase: "stream", outcome: "failure" },
  { phase: "submission", outcome: "failure" },
  { phase: "stream", outcome: "stop" },
  { phase: "submission", outcome: "stop" },
])("keeps email Resume checking during $phase until $outcome", async ({ phase, outcome }) => {
  const { backend, owner, sessionId, provider, advance, session, savedCall } = await setup();
  provider.call.name = "request_browser_handoff";
  provider.call.arguments = { message: "Complete the CAPTCHA" };
  await expect(advance()).resolves.toBe(false);
  expect(await session()).toMatchObject({
    state: { kind: "waiting", callId: "call-test" },
    active: true,
  });
  expect(closeFirecrawlBrowserSession).not.toHaveBeenCalled();
  expect(await savedCall()).toBeNull();
  const waiting = (await session()).state;
  if (waiting.kind !== "waiting" || waiting.expiresAt === undefined)
    throw new Error("Expected a handoff with a deadline");
  const expiresAt = waiting.expiresAt;
  const accessToken = `hh1_${"a".repeat(43)}`;
  expect(
    await backend.mutation(internal.tasks.handoffRecords.issue, {
      sessionId,
      access: {
        callId: waiting.callId,
        turnId: waiting.turnId,
        expiresAt,
        providerSessionId: "browser-test",
        tokenHash: createHash("sha256").update(accessToken).digest("hex"),
      },
    }),
  ).toBe(true);
  const evidence = {
    capturedAt: Date.now(),
    pages: [
      {
        tabId: "verified-tab",
        url: "https://example.test/verified",
        title: "Verified",
        content: "Verification complete",
      },
    ],
  };
  const checkId = await backend.run(async (ctx) => {
    const id = await ctx.db.insert("agentsApiRequestChecks", {
      sessionId,
      kind: "resume",
      model: "gpt-5.6-luna",
      prompt: "Continue after verification",
      handoff: {
        callId: waiting.callId,
        turnId: waiting.turnId,
        message: waiting.message,
        expiresAt,
      },
      providerSessionId: "browser-test",
      evidence,
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "checked", response: "approved", usage: null },
        result: { kind: "resume", decision: { kind: "approved" } },
      },
    });
    await ctx.db.patch(sessionId, { state: { kind: "checking", checkId: id } });
    return id;
  });
  const providerFetch = fetch;
  const entered = barrier();
  const proceed = barrier();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (
        new URL(request.url).pathname.endsWith("/sessions/session-test/events") &&
        request.method === (phase === "stream" ? "GET" : "POST")
      ) {
        entered.resolve();
        await proceed.promise;
        if (outcome === "failure")
          return Response.json(
            { error: { code: "resume_forbidden", message: "Resume delivery denied" } },
            { status: 403, headers: { "x-request-id": "req-resume-denied" } },
          );
      }
      return providerFetch(input, init);
    }),
  );
  const running = backend.action(internal.tasks.runtime.begin, {
    sessionId,
    command: { kind: "resume", checkId },
  });
  const completed =
    outcome === "failure"
      ? expect(running).rejects.toThrow("Resume delivery denied")
      : expect(running).resolves.toBe(true);
  await entered.promise;
  try {
    expect((await session()).state.kind).toBe("running");
    expect((await savedCall())?.result).toEqual({ kind: "running" });
    for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
      expect(await backend.action(action, { sessionId, accessToken })).toMatchObject({
        status: "checking",
      });
    }
    vi.setSystemTime(expiresAt + 1);
    if (outcome === "stop") await owner.mutation(api.tasks.sessions.stop, { sessionId });
  } finally {
    proceed.resolve();
    await completed;
  }
  if (outcome === "failure") {
    expect((await savedCall())?.result).toEqual({ kind: "running" });
    expect(await backend.action(api.tasks.handoff.load, { sessionId, accessToken })).toEqual({
      status: "failed",
      error: expect.stringContaining("Resume delivery denied"),
      diagnostic: expect.objectContaining({
        httpStatus: 403,
        providerCode: "resume_forbidden",
        requestId: "req-resume-denied",
      }),
    });
    expect((await session()).state).toMatchObject({
      kind: "failed",
      diagnostic: {
        httpStatus: 403,
        providerCode: "resume_forbidden",
        requestId: "req-resume-denied",
      },
    });
    return;
  }
  if (outcome === "stop") {
    expect(await backend.action(api.tasks.handoff.load, { sessionId, accessToken })).toEqual({
      status: "stopped",
    });
    expect(provider.events).toHaveLength(phase === "stream" ? 0 : 1);
    expect((await savedCall())?.result.kind).toBe(phase === "stream" ? "running" : "success");
    expect(await advance()).toBe(false);
    expect((await session()).cleanupJobId).toBeDefined();
    await backend.action(internal.tasks.runtime.cleanup, { sessionId });
    expect(await session()).toMatchObject({
      state: { kind: "stopped" },
      active: false,
      browser: null,
    });
    expect(provider.events.at(-1)).toEqual({ events: [{ type: "agent.session.input.cancel" }] });
    return;
  }
  const saved = await savedCall();
  expect(saved?.result.kind).toBe("success");
  if (saved?.result.kind !== "success") throw new Error("Resume result was not persisted");
  expect(JSON.parse(saved.result.output)).toMatchObject({ browser: evidence });
  expect(provider.events).toEqual([
    {
      events: [
        {
          type: "agent.session.input.tool_result",
          turn_id: provider.call.turn_id,
          call_id: provider.call.call_id,
          success: true,
          output: saved.result.output,
        },
      ],
    },
  ]);
  expect(provider.inputKeys).toEqual([`${sessionId}:${checkId}`]);
  expect(await session()).toMatchObject({ state: { kind: "running" }, active: true });
  expect(await backend.action(api.tasks.handoff.load, { sessionId, accessToken })).toEqual({
    status: "continued",
    scoutName: "Scout",
  });
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

it("marks failed tool items complete and advances the cursor up to the next unfinished item", async () => {
  const { provider, advance, session, history } = await setup();
  provider.items.push(
    reasoning("head", "completed"),
    {
      id: "failed-call",
      type: "function_call",
      name: "set_review_site",
      call_id: "cancelled-call",
      arguments: { site: "example.test" },
      status: "failed",
      turn_id: "previous-turn",
    },
    {
      id: "failed-output",
      type: "function_call_output",
      call_id: "cancelled-call",
      output: null,
      error: "Tool call was cancelled.",
      status: "failed",
      turn_id: "previous-turn",
    },
    reasoning("tail", "completed"),
    reasoning("still-running", "in_progress"),
  );

  await advance();
  expect(
    (await history()).map(({ providerItemId, complete }) => ({ providerItemId, complete })),
  ).toEqual([
    { providerItemId: "head", complete: true },
    { providerItemId: "failed-call", complete: true },
    { providerItemId: "failed-output", complete: true },
    { providerItemId: "tail", complete: true },
    { providerItemId: "still-running", complete: false },
  ]);
  expect((await session()).itemCursor).toBe("tail");

  provider.after.length = 0;
  provider.items[4] = reasoning("still-running", "completed");
  await advance();
  expect(provider.after).toEqual(["tail", "tail"]);
  expect((await session()).itemCursor).toBe("still-running");
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
  provider.beforeRetrieve.mockRejectedValue(new Error("Cancellation unavailable"));
  const run = () => backend.action(internal.tasks.runtime.cleanup, { sessionId });
  const cleanup = expect(run()).rejects.toThrow("Connection error.");
  await vi.advanceTimersByTimeAsync(10_000);
  await cleanup;
  expect(provider.beforeRetrieve).toHaveBeenCalledTimes(4);
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
  expect(await session()).toMatchObject({ active: true, browser: null });
  provider.beforeRetrieve.mockResolvedValue(undefined);
  await run();
  expect((await session()).active).toBe(false);
  expect(closeFirecrawlBrowserSession).toHaveBeenCalledOnce();
});

it("retries failed cleanup only on Stop, deduplicates pending/running jobs, and clears the job before the next send", async () => {
  const { backend, owner, sessionId, provider, session } = await setup();
  await backend.mutation(internal.tasks.sessions.update, {
    sessionId,
    state: { kind: "failed", error: "Run failed" },
  });
  await backend.mutation(internal.tasks.sessions.scheduleCleanup, { sessionId });
  const firstJobId = (await session()).cleanupJobId;
  if (!firstJobId) throw new Error("Cleanup was not scheduled");
  provider.beforeRetrieve.mockRejectedValue(new Error("Cancellation unavailable"));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await backend.finishAllScheduledFunctions(vi.runAllTimers);
    expect(errorLog).toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
  expect((await backend.run((ctx) => ctx.db.system.get(firstJobId)))?.state.kind).toBe("failed");
  expect(await session()).toMatchObject({ active: true, browser: null });
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  const retryJobId = (await session()).cleanupJobId;
  if (!retryJobId) throw new Error("Cleanup retry was not scheduled");
  expect(retryJobId).not.toBe(firstJobId);
  await owner.mutation(api.tasks.sessions.stop, { sessionId });
  expect((await session()).cleanupJobId).toBe(retryJobId);
  provider.beforeRetrieve.mockResolvedValue(undefined).mockImplementationOnce(async () => {
    expect((await backend.run((ctx) => ctx.db.system.get(retryJobId)))?.state.kind).toBe(
      "inProgress",
    );
    await owner.mutation(api.tasks.sessions.stop, { sessionId });
    expect((await session()).cleanupJobId).toBe(retryJobId);
    await expect(
      owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" }),
    ).rejects.toThrow("Stop the current run");
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await session()).active).toBe(false);
  expect((await backend.run((ctx) => ctx.db.system.get(retryJobId)))?.state.kind).toBe("success");
  await owner.mutation(api.tasks.sessions.send, { sessionId, message: "Next task" });
  expect((await session()).cleanupJobId).toBeUndefined();
  expect(provider.beforeRetrieve).toHaveBeenCalledTimes(9);
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
  await backend.mutation(internal.tasks.sessions.claimCall, {
    sessionId,
    callId: provider.call.call_id,
  });
  await expect(advance()).rejects.toThrow("Tool execution was interrupted");
  expect(execute).not.toHaveBeenCalled();
  expect(runtimeTools).not.toHaveBeenCalled();
  expect(provider.events).toEqual([]);
});
