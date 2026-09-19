/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import agentTest from "@convex-dev/agent/test";
import { saveMessage, type MessageDoc } from "@convex-dev/agent";
import { tool } from "ai";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
import { createBrowserHarness } from "../scout/browserTools";
import { createServiceAccountRecordingTool } from "../scout/serviceAccountTool";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { runtimeTools } from "./tools";
import {
  accumulatedUsage,
  modelToolOutput,
  pendingToolCalls,
  prepareContext,
  projectMessage,
  type CompletedCall,
} from "./convexAgentModel";

const provider = vi.hoisted(() => ({
  stream: vi.fn<LanguageModelV4["doStream"]>(),
  generate: vi.fn<LanguageModelV4["doGenerate"]>(),
}));
vi.mock("@convex-dev/ai-sdk-provider", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    convexGateway: vi.fn(
      (modelId: string) =>
        new MockLanguageModelV4({
          modelId,
          provider: "convexGateway",
          doStream: provider.stream,
          doGenerate: provider.generate,
        }),
    ),
  };
});
vi.mock("./tools", async (original) => ({
  ...(await original<typeof import("./tools")>()),
  runtimeTools: vi.fn(),
}));
vi.mock("./execution", async (original) => ({
  ...(await original<typeof import("./execution")>()),
  taskInstructions: vi.fn(async () => "Complete the user's task."),
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
const execute = vi.fn(async ({ value }: { value: string }) => ({ currentPage: value, done: true }));
const countItems = vi.fn(async ({ count, label }: { count: number; label: string }) => ({
  count,
  label,
}));
const recordAccount = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));

beforeEach(() => {
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  provider.stream.mockReset();
  provider.generate.mockReset();
  execute.mockClear();
  countItems.mockClear();
  recordAccount.mockClear();
  vi.mocked(runtimeTools).mockImplementation(async () => ({
    tools: {
      browser_read: tool({ inputSchema: z.object({ value: z.string() }), execute }),
      count_items: tool({
        inputSchema: z.object({ count: z.number(), label: z.string() }),
        execute: countItems,
      }),
      request_browser_handoff: tool({ inputSchema: z.object({ message: z.string() }) }),
      record_authenticated_service_account: createServiceAccountRecordingTool(recordAccount),
    },
    browser: createBrowserHarness(),
    dispose: async () => {},
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function streamed(
  content: LanguageModelV4StreamPart[],
  finishReason: "stop" | "tool-calls" = "stop",
) {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const part of content) controller.enqueue(part);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: finishReason, raw: finishReason },
          usage: {
            inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
            outputTokens: { total: 30, text: 20, reasoning: 10 },
            raw: { cost: 0.002 },
          },
        });
        controller.close();
      },
    }),
  };
}
function textStream(text: string) {
  return streamed([
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: text },
    { type: "text-end", id: "text" },
  ]);
}

async function setup() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  const sessionId = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "test", address: "scout@example.test" },
      firecrawl: { profileName: "test" },
    });
    return await ctx.db.insert("agentsApiSessions", {
      engine: "convex_agent",
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Task",
      model: "gpt-5.6-luna",
      state: { kind: "running" },
      active: true,
      nextSequence: 0,
      browser: null,
      usage: null,
    });
  });
  await backend.mutation(internal.tasks.convexAgentRecords.prompt, {
    sessionId,
    prompt: "Inspect the product and save a walkthrough.",
    start: true,
  });
  return {
    backend,
    sessionId,
    advance: () => backend.action(internal.tasks.runtime.advance, { sessionId }),
    session: () => backend.run((ctx) => ctx.db.get(sessionId)),
    items: () =>
      backend.run((ctx) =>
        ctx.db
          .query("agentsApiItems")
          .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", sessionId))
          .take(100),
      ),
  };
}

it("records captured paid generations once even after the session starts a free follow-up", async () => {
  const task = await setup();
  const session = await task.session();
  if (!session) throw new Error("Task session is missing");
  await task.backend.mutation(internal.credits.grantOnSignIn, { userId: session.userId });
  await task.backend.run(async (ctx) => {
    await ctx.db.patch(task.sessionId, {
      billingEnabled: false,
      previousTurnId: "new-free-prompt",
    });
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", session.userId))
      .unique();
    if (!wallet) throw new Error("Wallet missing");
    await ctx.db.patch(wallet._id, { balanceUnits: 1 });
  });
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 80,
    reasoningTokens: 0,
    costUsd: 0.001,
  };
  const args = {
    sessionId: task.sessionId,
    billingEnabled: true,
    sourceKey: "convex:old-paid-prompt:step:0",
    usage,
  };
  await task.backend.mutation(internal.tasks.convexAgentRecords.recordUsage, args);
  await task.backend.mutation(internal.tasks.convexAgentRecords.recordUsage, args);
  await task.backend.mutation(internal.tasks.convexAgentRecords.recordUsage, {
    ...args,
    sourceKey: "convex:free-prompt:step:0",
    billingEnabled: false,
  });
  await task.backend.mutation(internal.tasks.convexAgentRecords.recordUsage, {
    ...args,
    sourceKey: "convex:missing-cost:step:0",
    usage: { ...usage, costUsd: null },
  });
  const wallet = await task.backend.run((ctx) =>
    ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", session.userId))
      .unique(),
  );
  expect(wallet?.balanceUnits).toBe(-999);
  expect(await task.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect())).toHaveLength(
    1,
  );
  expect((await task.session())?.modelUsageIncomplete).toBe(true);
});

it("runs one model step, executes the shared tool separately, and projects stable common items", async () => {
  const task = await setup();
  provider.stream.mockResolvedValueOnce(
    streamed(
      [
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", delta: "Inspect first." },
        { type: "reasoning-end", id: "r" },
        {
          type: "tool-call",
          toolCallId: "read-1",
          toolName: "browser_read",
          input: JSON.stringify({ value: "Page evidence" }),
        },
      ],
      "tool-calls",
    ),
  );
  provider.stream.mockResolvedValueOnce(textStream("Verified the product."));
  expect(await task.advance()).toBe(true);
  expect(provider.stream).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
  expect(await task.advance()).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(provider.stream).toHaveBeenCalledTimes(1);
  expect(await task.advance()).toBe(true);
  expect(await task.advance()).toBe(false);
  const session = await task.session();
  expect(session).toMatchObject({
    active: false,
    state: { kind: "idle" },
    usage: { inputTokens: 200, outputTokens: 60, cachedInputTokens: 40 },
    reportedModelUsd: 0.004,
  });
  const items = await task.items();
  expect(items.filter((item) => item.kind === "tool_call")).toHaveLength(1);
  expect(items.filter((item) => item.kind === "assistant")).toMatchObject([
    { text: "Verified the product.", complete: true },
  ]);
  expect(provider.stream.mock.calls[1][0].prompt).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
  );
  expect(provider.stream.mock.calls[0][0].providerOptions).toEqual({
    convexGateway: { reasoningEffort: "max" },
  });
  if (!session?.providerId) throw new Error("Thread missing");
  const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
    threadId: session.providerId,
    order: "asc",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(messages.page.filter((message) => message.usage)).toHaveLength(2);
  expect(accumulatedUsage(messages.page).usage.costUsd).toBe(0.004);
});

it.each(["managed_password", "passwordless", "oauth"] as const)(
  "persists and executes a generated %s account recording with the shared tool",
  async (loginMethod) => {
    const task = await setup();
    const input = {
      accountAccess: "created",
      identifier: "scout@example.test",
      verification: "Account settings shows scout@example.test after email verification.",
      ...(loginMethod === "oauth"
        ? {
            loginMethod,
            oauthProviderServiceDomain: "github.com",
            oauthProviderIdentifier: "scout-test",
          }
        : { loginMethod }),
    };
    const callId = "record-account";
    const name = "record_authenticated_service_account";
    provider.stream.mockResolvedValueOnce(
      streamed(
        [{ type: "tool-call", toolCallId: callId, toolName: name, input: JSON.stringify(input) }],
        "tool-calls",
      ),
    );

    expect(await task.advance()).toBe(true);
    expect(recordAccount).not.toHaveBeenCalled();
    const session = await task.session();
    if (!session?.providerId) throw new Error("Thread missing");
    const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
      threadId: session.providerId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const pending = pendingToolCalls(messages.page);
    const item = (await task.items()).find((item) => item.kind === "tool_call");

    expect(await task.advance()).toBe(true);
    const call = await task.backend.run((ctx) =>
      ctx.db
        .query("agentsApiCalls")
        .withIndex("by_session_id_and_call_id", (q) =>
          q.eq("sessionId", task.sessionId).eq("callId", callId),
        )
        .unique(),
    );
    expect(call?.result).toEqual({
      kind: "success",
      output: JSON.stringify({ serviceAccountId: "account-1", created: true }),
    });
    expect(pending).toEqual([{ callId, name, arguments: input }]);
    expect(JSON.parse(item?.details ?? "null")).toMatchObject({ input });
    expect(recordAccount).toHaveBeenCalledExactlyOnceWith(
      {
        accountAccess: input.accountAccess,
        identifier: input.identifier,
        verification: input.verification,
        loginMethod:
          loginMethod === "oauth"
            ? {
                kind: "oauth",
                providerServiceDomain: "github.com",
                providerIdentifier: "scout-test",
              }
            : { kind: loginMethod },
      },
      expect.any(AbortSignal),
    );
    expect(provider.stream).toHaveBeenCalledTimes(1);
  },
);

it("repairs a stringified number before persisting and executing a tool call", async () => {
  const task = await setup();
  provider.stream.mockResolvedValueOnce(
    streamed(
      [
        {
          type: "tool-call",
          toolCallId: "repair-count",
          toolName: "count_items",
          input: JSON.stringify({ count: "30", label: "42" }),
        },
      ],
      "tool-calls",
    ),
  );
  expect(await task.advance()).toBe(true);
  const call = (await task.items()).find((item) => item.kind === "tool_call");
  expect(JSON.parse(call?.details ?? "null")).toMatchObject({
    input: { count: 30, label: "42" },
  });
  expect(await task.advance()).toBe(true);
  expect(countItems).toHaveBeenCalledTimes(1);
  expect(countItems.mock.calls[0][0]).toEqual({ count: 30, label: "42" });
});

it.each([false, true])(
  "keeps an interrupted call terminal after follow-up without reexecution (claimed: %s)",
  async (claimed) => {
    const task = await setup();
    const callId = "interrupted";
    const callStream = () =>
      streamed(
        [
          {
            type: "tool-call",
            toolCallId: callId,
            toolName: "browser_read",
            input: JSON.stringify({ value: "Evidence" }),
          },
        ],
        "tool-calls",
      );
    provider.stream.mockResolvedValueOnce(callStream());
    await task.advance();
    if (claimed)
      await task.backend.mutation(internal.tasks.sessions.claimCall, {
        sessionId: task.sessionId,
        callId,
      });
    await task.backend.run((ctx) => ctx.db.patch(task.sessionId, { state: { kind: "stopped" } }));
    await task.backend.action(internal.tasks.runtime.cleanup, { sessionId: task.sessionId });
    const session = await task.session();
    if (!session?.providerId) throw new Error("Thread missing");
    const expectedError = claimed
      ? "Tool execution was interrupted. Its outcome is unknown; inspect the task records before repeating it."
      : "Task stopped before this tool was executed.";
    const sharedCall = await task.backend.run((ctx) =>
      ctx.db
        .query("agentsApiCalls")
        .withIndex("by_session_id_and_call_id", (q) =>
          q.eq("sessionId", task.sessionId).eq("callId", callId),
        )
        .unique(),
    );
    expect(sharedCall?.result).toEqual({ kind: "interrupted", error: expectedError });
    const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
      threadId: session.providerId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(pendingToolCalls(messages.page)).toEqual([]);
    expect(messages.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: callId,
                toolName: "browser_read",
                output: { type: "error-text", value: expectedError },
              },
            ],
          },
        }),
      ]),
    );
    const visibleItems = () =>
      task.backend.withIdentity({ subject: session.userId }).query(api.tasks.sessions.listItems, {
        sessionId: task.sessionId,
        paginationOpts: { cursor: null, numItems: 20 },
      });
    expect((await visibleItems()).page.find((item) => item.kind === "tool_call")?.tool?.state).toBe(
      "interrupted",
    );
    await task.backend.run((ctx) =>
      ctx.db.patch(task.sessionId, { active: true, state: { kind: "running" } }),
    );
    await task.backend.action(internal.tasks.runtime.begin, {
      sessionId: task.sessionId,
      command: { kind: "send", message: "Continue the task." },
    });
    expect((await visibleItems()).page.find((item) => item.kind === "tool_call")?.tool?.state).toBe(
      "interrupted",
    );
    // Even a repeated provider call ID must reuse the terminal result, never its effects.
    provider.stream.mockResolvedValueOnce(callStream());
    expect(await task.advance()).toBe(true);
    expect(await task.advance()).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect((await visibleItems()).page.find((item) => item.kind === "tool_call")?.tool?.state).toBe(
      "interrupted",
    );
  },
);

it.each(["stopped", "failed"] satisfies Array<"stopped" | "failed">)(
  "records a cancelled handoff as interrupted when the task %s",
  async (state) => {
    const task = await setup();
    provider.stream.mockResolvedValueOnce(
      streamed(
        [
          {
            type: "tool-call",
            toolCallId: "handoff",
            toolName: "request_browser_handoff",
            input: JSON.stringify({ message: "Solve the CAPTCHA" }),
          },
        ],
        "tool-calls",
      ),
    );
    await task.advance();
    const session = await task.session();
    if (!session?.previousTurnId || !session.providerId) throw new Error("Thread missing");
    await task.backend.run((ctx) =>
      ctx.db.patch(task.sessionId, {
        state: state === "stopped" ? { kind: "stopped" } : { kind: "failed", error: "Task failed" },
      }),
    );
    await task.backend.mutation(internal.tasks.convexAgentRecords.interruptTool, {
      sessionId: task.sessionId,
      promptMessageId: session.previousTurnId,
      callId: "handoff",
      name: "request_browser_handoff",
    });
    const error = `Browser handoff was cancelled because the task ${state} before browser control returned to Scout.`;
    expect(
      await task.backend.mutation(internal.tasks.sessions.claimCall, {
        sessionId: task.sessionId,
        callId: "handoff",
      }),
    ).toMatchObject({ fresh: false, call: { result: { kind: "interrupted", error } } });
    const items = await task.backend
      .withIdentity({ subject: session.userId })
      .query(api.tasks.sessions.listItems, {
        sessionId: task.sessionId,
        paginationOpts: { cursor: null, numItems: 20 },
      });
    expect(items.page.find((item) => item.kind === "tool_call")?.tool).toMatchObject({
      state: "interrupted",
      error,
    });
    const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
      threadId: session.providerId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(pendingToolCalls(messages.page)).toEqual([]);
    expect(messages.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "handoff",
                toolName: "request_browser_handoff",
                output: { type: "error-text", value: error },
              },
            ],
          },
        }),
      ]),
    );
    expect(execute).not.toHaveBeenCalled();
  },
);

it.each([
  { kind: "success", output: JSON.stringify({ saved: true }) },
  { kind: "error", error: "The provider rejected the operation" },
] satisfies CompletedCall[])(
  "preserves an existing terminal $kind during cancellation",
  async (result) => {
    const task = await setup();
    provider.stream.mockResolvedValueOnce(
      streamed(
        [
          {
            type: "tool-call",
            toolCallId: "finished",
            toolName: "browser_read",
            input: JSON.stringify({ value: "Evidence" }),
          },
        ],
        "tool-calls",
      ),
    );
    await task.advance();
    const session = await task.session();
    if (!session?.previousTurnId || !session.providerId) throw new Error("Thread missing");
    const claimed = await task.backend.mutation(internal.tasks.sessions.claimCall, {
      sessionId: task.sessionId,
      callId: "finished",
    });
    await task.backend.mutation(internal.tasks.sessions.finishCall, {
      callId: claimed.call._id,
      result,
    });
    await task.backend.run((ctx) => ctx.db.patch(task.sessionId, { state: { kind: "stopped" } }));
    await task.backend.mutation(internal.tasks.convexAgentRecords.interruptTool, {
      sessionId: task.sessionId,
      promptMessageId: session.previousTurnId,
      callId: "finished",
      name: "browser_read",
    });
    expect(
      await task.backend.mutation(internal.tasks.sessions.claimCall, {
        sessionId: task.sessionId,
        callId: "finished",
      }),
    ).toMatchObject({ fresh: false, call: { result } });
    const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
      threadId: session.providerId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(pendingToolCalls(messages.page)).toEqual([]);
    expect(messages.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "finished",
                toolName: "browser_read",
                output:
                  result.kind === "success"
                    ? { type: "json", value: { saved: true } }
                    : { type: "error-text", value: result.error },
              },
            ],
          },
        }),
      ]),
    );
    expect(execute).not.toHaveBeenCalled();
  },
);

it("pauses an unresolved handoff without running later calls", async () => {
  const task = await setup();
  await task.backend.run(async (ctx) =>
    ctx.db.patch(task.sessionId, {
      browser: {
        providerSessionId: "browser",
        providerExpiresAtMs: Date.now() + 3_600_000,
        cdpUrl: "wss://example.test",
        interactiveLiveViewUrl: "https://example.test",
        liveViewUrl: null,
        currentUrl: null,
      },
    }),
  );
  provider.stream.mockResolvedValueOnce(
    streamed(
      [
        {
          type: "tool-call",
          toolCallId: "handoff",
          toolName: "request_browser_handoff",
          input: JSON.stringify({ message: "Solve the CAPTCHA" }),
        },
        {
          type: "tool-call",
          toolCallId: "after",
          toolName: "browser_read",
          input: JSON.stringify({ value: "Later" }),
        },
      ],
      "tool-calls",
    ),
  );
  await task.advance();
  expect(await task.advance()).toBe(false);
  const session = await task.session();
  expect(session?.state).toMatchObject({
    kind: "waiting",
    callId: "handoff",
    turnId: session?.previousTurnId,
  });
  expect(execute).not.toHaveBeenCalled();
  if (!session?.providerId) throw new Error("Thread missing");
  const messages = await task.backend.query(components.agent.messages.listMessagesByThreadId, {
    threadId: session.providerId,
    order: "asc",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(pendingToolCalls(messages.page).map((call) => call.callId)).toEqual(["handoff", "after"]);
  if (session.state.kind !== "waiting") throw new Error("Task is not waiting");
  const handoff = session.state;
  if (handoff.expiresAt === undefined) throw new Error("Handoff deadline missing");
  const expiresAt = handoff.expiresAt;
  const accessToken = `hh1_${"a".repeat(43)}`;
  expect(
    await task.backend.mutation(internal.tasks.handoffRecords.issue, {
      sessionId: task.sessionId,
      access: {
        callId: handoff.callId,
        turnId: handoff.turnId,
        expiresAt,
        providerSessionId: "browser",
        tokenHash: createHash("sha256").update(accessToken).digest("hex"),
      },
    }),
  ).toBe(true);
  const checkId = await task.backend.run(async (ctx) => {
    const id = await ctx.db.insert("agentsApiRequestChecks", {
      sessionId: task.sessionId,
      kind: "resume",
      model: "gpt-5.6-luna",
      prompt: "Inspect the product",
      handoff: {
        callId: handoff.callId,
        turnId: handoff.turnId,
        message: handoff.message,
        expiresAt,
      },
      providerSessionId: "browser",
      evidence: {
        capturedAt: Date.now(),
        pages: [
          {
            tabId: "tab",
            url: "https://example.test",
            title: "Product",
            content: "Verification complete",
          },
        ],
      },
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "checked", response: "approved", usage: null },
        result: { kind: "resume", decision: { kind: "approved" } },
      },
    });
    await ctx.db.patch(task.sessionId, { state: { kind: "checking", checkId: id } });
    return id;
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 46 * 60_000);
  try {
    expect(
      await task.backend.action(api.tasks.handoff.load, { sessionId: task.sessionId, accessToken }),
    ).toMatchObject({ status: "checking" });
    expect(
      await task.backend.mutation(internal.tasks.convexAgentRecords.resume, {
        sessionId: task.sessionId,
        checkId,
      }),
    ).toBe(true);
    expect(
      await task.backend.mutation(internal.tasks.convexAgentRecords.resume, {
        sessionId: task.sessionId,
        checkId,
      }),
    ).toBe(false);
    expect(
      await task.backend.action(api.tasks.handoff.load, { sessionId: task.sessionId, accessToken }),
    ).toEqual({ status: "continued", scoutName: "Scout" });
    expect(await task.advance()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    provider.stream.mockResolvedValueOnce(textStream("Continued after handoff."));
    expect(await task.advance()).toBe(true);
    expect(provider.stream).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

it("uses a whole advance for compaction and includes its usage only once", async () => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  const task = await setup();
  const ownerId = (await task.session())?.userId;
  if (!ownerId) throw new Error("Task owner missing");
  await task.backend.mutation(internal.credits.grantOnSignIn, { userId: ownerId });
  await task.backend.run((ctx) => ctx.db.patch(task.sessionId, { billingEnabled: true }));
  const session = await task.session();
  if (!session?.providerId || !session.previousTurnId) throw new Error("Task thread missing");
  const threadId = session.providerId;
  provider.generate.mockResolvedValueOnce({
    content: [{ type: "text", text: "Earlier product findings preserved." }],
    finishReason: { unified: "stop", raw: "stop" },
    warnings: [],
    usage: {
      inputTokens: { total: 200, noCache: 200, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 40, text: 40, reasoning: 0 },
      raw: { cost: 0.01 },
    },
  });
  await task.backend.run(async (ctx) => {
    for (let index = 0; index < 18; index++)
      await saveMessage(ctx, components.agent, {
        threadId,
        prompt: `Earlier finding ${index}: ${"Evidence ".repeat(1400)}`,
      });
  });
  await task.backend.mutation(internal.tasks.convexAgentRecords.prompt, {
    sessionId: task.sessionId,
    start: false,
    prompt: "Continue the original review using the findings above.",
  });
  expect(await task.advance()).toBe(true);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(provider.stream).not.toHaveBeenCalled();
  const context = await task.backend.query(internal.tasks.convexAgentRecords.context, {
    sessionId: task.sessionId,
  });
  expect(context).toMatchObject({
    summary: "Earlier product findings preserved.",
    usage: { costUsd: 0.01 },
  });
  expect((await task.session())?.reportedModelUsd).toBe(0.01);

  provider.stream.mockResolvedValueOnce(textStream("Continued with the saved findings."));
  expect(await task.advance()).toBe(true);
  const modelInput = JSON.stringify(provider.stream.mock.calls[0][0].prompt);
  expect(modelInput).toContain("Earlier product findings preserved.");
  expect(modelInput).not.toContain("Earlier finding 0:");
  expect((await task.session())?.reportedModelUsd).toBe(0.012);
  const totals = await task.backend.run((ctx) => ctx.db.query("creditUsageTotals").collect());
  expect(totals.map((total) => total.totalCostMicrodollars).sort((a, b) => a - b)).toEqual([
    2_000, 10_000,
  ]);
  const wallet = await task.backend.run((ctx) =>
    ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", ownerId))
      .unique(),
  );
  expect(wallet?.balanceUnits).toBe(488_000);
});

function message(id: number, content: string): MessageDoc {
  return {
    _id: `message-${id}`,
    _creationTime: id,
    threadId: "thread",
    order: id,
    stepOrder: 0,
    status: "success",
    tool: false,
    message: { role: "user", content },
  };
}

it("summarizes complete older history instead of dropping messages past a recent-message window", () => {
  const history = Array.from({ length: 125 }, (_, index) =>
    message(index, `Evidence ${index}: ${"observed ".repeat(200)}`),
  );
  const objective = history[0];
  history.splice(5, 0, {
    _id: "empty",
    _creationTime: 5,
    threadId: "thread",
    order: 5,
    stepOrder: 0,
    status: "success",
    tool: false,
  });
  const prepared = prepareContext(history, objective, null, 100, 32_000);
  expect(prepared.kind).toBe("compact");
  if (prepared.kind !== "compact") throw new Error("Expected compaction");
  expect(JSON.stringify(prepared.input)).toContain("Evidence 1:");
  expect(prepared.coveredThrough.order).toBeLessThan(117);
  const lastSummarized = prepared.input.messages.at(-1);
  expect(lastSummarized?.content).toContain(`Evidence ${prepared.coveredThrough.order}:`);
  prepared.validateSummary("Saved findings and constraints.");
  expect(() => prepared.validateSummary("")).toThrow("nonempty");
});

it("strips superseded snapshots even in the recent eight messages while preserving other evidence", () => {
  const objective = message(0, "Review the checkout");
  const history = [objective];
  for (let index = 1; index <= 3; index++) {
    history.push({
      ...message(index * 2, ""),
      message: {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: `read-${index}`, toolName: "browser_read", input: {} },
        ],
      },
    });
    history.push({
      ...message(index * 2 + 1, ""),
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: `read-${index}`,
            toolName: "browser_read",
            output: {
              type: "json",
              value: { currentPage: `Snapshot ${index}`, evidence: `Evidence ${index}` },
            },
          },
        ],
      },
    });
  }
  const prepared = prepareContext(history, objective, null, 0, 32_000);
  expect(prepared.kind).toBe("ready");
  if (prepared.kind !== "ready") throw new Error("Unexpected compaction");
  const serialized = JSON.stringify(prepared.messages);
  expect(serialized).not.toContain("Snapshot 1");
  expect(serialized).not.toContain("Snapshot 2");
  expect(serialized).toContain("Snapshot 3");
  expect(serialized).toContain("Evidence 1");
  expect(serialized).toContain("Evidence 2");
  expect(JSON.stringify(history)).toContain("Snapshot 1");
});

it("preserves native model-output envelopes and leaves unknown pricing unknown", () => {
  expect(
    modelToolOutput({
      kind: "success",
      output: JSON.stringify({ type: "content", value: [{ type: "text", text: "Email body" }] }),
    }),
  ).toEqual({ type: "content", value: [{ type: "text", text: "Email body" }] });
  expect(
    modelToolOutput({ kind: "success", output: JSON.stringify({ currentPage: "Evidence" }) }),
  ).toEqual({ type: "json", value: { currentPage: "Evidence" } });
  const doc: MessageDoc = {
    ...message(0, ""),
    message: { role: "assistant", content: "Done" },
    usage: { promptTokens: 4, completionTokens: 3 },
  };
  expect(accumulatedUsage([doc])).toMatchObject({
    usage: { inputTokens: 4, outputTokens: 3, cachedInputTokens: null, costUsd: null },
    incomplete: false,
  });
  expect(
    accumulatedUsage([
      doc,
      { ...message(1, ""), status: "failed", message: { role: "assistant", content: "Partial" } },
    ]),
  ).toMatchObject({ usage: { inputTokens: 4, outputTokens: 3 }, incomplete: true });
  expect(projectMessage(doc)[0]).toMatchObject({ kind: "assistant", text: "Done", complete: true });
});

it("aborts an active model stream on stop and keeps its partial transcript", async () => {
  const task = await setup();
  provider.stream.mockResolvedValueOnce(textStream("Completed first step."));
  expect(await task.advance()).toBe(true);
  expect(await task.advance()).toBe(false);
  await task.backend.mutation(internal.tasks.convexAgentRecords.prompt, {
    sessionId: task.sessionId,
    prompt: "Continue the task.",
    start: false,
  });
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  provider.stream.mockImplementationOnce(async ({ abortSignal }) => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "partial" });
        controller.enqueue({ type: "text-delta", id: "partial", delta: "Working on the product" });
        abortSignal?.addEventListener("abort", () => controller.close(), { once: true });
        started();
      },
    }),
  }));
  const advancing = task.advance();
  await ready;
  await task.backend.run((ctx) => ctx.db.patch(task.sessionId, { state: { kind: "stopped" } }));
  expect(await advancing).toBe(false);
  await task.backend.action(internal.tasks.runtime.cleanup, { sessionId: task.sessionId });
  expect((await task.items()).filter((item) => item.kind === "assistant")).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "Working on the product" })]),
  );
  expect(await task.session()).toMatchObject({
    usage: { inputTokens: 100, outputTokens: 30 },
    reportedModelUsd: 0.002,
    modelUsageIncomplete: true,
  });
  expect((await task.session())?.state).toEqual({ kind: "stopped" });
  expect(execute).not.toHaveBeenCalled();
});
