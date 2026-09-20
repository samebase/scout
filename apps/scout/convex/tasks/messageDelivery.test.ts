/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import type {
  AgentSessionAssistantMessage,
  AgentSessionEvent,
} from "openai/resources/beta/agents/agents";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, components, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { followUpContext } from "./instructions";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const message = 'Try again.\n\nKeep  these "exact words".';
const messageContent = [
  { type: "input_text", text: message },
  { type: "input_text", text: followUpContext(undefined) },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("CREDITS_ENABLED", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(engine: "agents_api" | "convex_agent") {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { userId, sessionId } = await backend.run(async (ctx) => {
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
      engine,
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      active: false,
      state: { kind: "idle" },
      nextSequence: 0,
      usage: null,
      browser: null,
    });
    return { userId, sessionId };
  });
  if (engine === "agents_api")
    await backend.run((ctx) => ctx.db.patch(sessionId, { providerId: "session-test" }));
  else
    await backend.mutation(internal.tasks.convexAgentRecords.prompt, {
      sessionId,
      prompt: "Original task",
      start: true,
    });
  const owner = backend.withIdentity({ subject: userId });
  await owner.mutation(api.tasks.sessions.send, { sessionId, message });
  const session = () => backend.run((ctx) => ctx.db.get(sessionId));
  const queued = await session();
  if (!queued?.pendingMessage) throw new Error("Expected a queued follow-up");
  return { backend, owner, sessionId, session, pendingMessage: queued.pendingMessage };
}

it.each(["turns", "stream", "post", "post_400", "post_408", "post_429", "after_ack"] as const)(
  "preserves the correct delivery state when Agents API fails at %s",
  async (failure) => {
    const task = await setup("agents_api");
    const posted: unknown[] = [];
    const unavailable = (status = 500) =>
      Response.json(
        {
          error: {
            message:
              status === 400
                ? "Cannot create a turn in a failed managed agent session"
                : "Provider unavailable",
          },
        },
        {
          status,
          headers: { "x-should-retry": "false", "x-request-id": "req-http-test" },
        },
      );
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path.endsWith("/sessions/session-test/turns"))
        return failure === "turns" ? unavailable() : Response.json({ data: [], has_more: false });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/items"))
        return Response.json({ data: [], has_more: false });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/events")) {
        if (failure === "stream") return unavailable();
        return new Response(
          'data: {"type":"error","error":{"message":"Stream failed after acknowledgement","code":"invalid_request"}}\n\n',
          {
            headers: { "Content-Type": "text/event-stream", "x-request-id": "req-stream-test" },
          },
        );
      }
      if (request.method === "POST" && path.endsWith("/sessions/session-test/events")) {
        expect((await task.session())?.pendingMessage).toEqual({
          ...task.pendingMessage,
          status: "submitting",
        });
        const body: unknown = await request.json();
        posted.push(body);
        if (failure === "post_400") return unavailable(400);
        if (failure === "post_408") return unavailable(408);
        if (failure === "post_429") return unavailable(429);
        return failure === "post" ? unavailable() : new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      task.backend.action(internal.tasks.runtime.begin, {
        sessionId: task.sessionId,
        command: { kind: "send", message },
      }),
    ).rejects.toThrow(
      failure === "after_ack"
        ? "Stream failed after acknowledgement"
        : failure === "post_400"
          ? "Cannot create a turn in a failed managed agent session"
          : "Provider unavailable",
    );
    expect((await task.session())?.state).toMatchObject({
      kind: "failed",
      diagnostic: {
        operation: "send",
        provider: "openai",
        requestId: failure === "after_ack" ? "req-stream-test" : "req-http-test",
      },
    });

    const beforeSubmission = failure === "turns" || failure === "stream";
    expect(posted).toEqual(
      beforeSubmission
        ? []
        : [
            {
              events: [
                {
                  type: "agent.session.input.message",
                  input: [{ role: "user", content: messageContent }],
                },
              ],
            },
          ],
    );
    expect((await task.session())?.pendingMessage).toEqual(
      beforeSubmission
        ? task.pendingMessage
        : failure === "post" || failure === "post_408"
          ? { ...task.pendingMessage, status: "submitting" }
          : failure === "post_400" || failure === "post_429"
            ? task.pendingMessage
            : undefined,
    );
    await task.backend.mutation(internal.tasks.sessions.update, {
      sessionId: task.sessionId,
      active: false,
      state: { kind: "failed", error: "Provider unavailable" },
    });
    const requestsBeforeRetry = fetchMock.mock.calls.length;
    const retry = task.owner.mutation(api.tasks.sessions.retryMessage, {
      sessionId: task.sessionId,
    });
    if (beforeSubmission || failure === "post_400" || failure === "post_429") {
      await expect(retry).resolves.toBeNull();
      expect((await task.session())?.pendingMessage).toMatchObject({ message, status: "queued" });
    } else await expect(retry).rejects.toThrow("not been submitted");
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeRetry);
  },
);

it("clears Convex Agent pending delivery together with its saved prompt", async () => {
  const task = await setup("convex_agent");
  await expect(
    task.backend.action(internal.tasks.runtime.begin, {
      sessionId: task.sessionId,
      command: { kind: "send", message },
    }),
  ).resolves.toBe(true);
  const accepted = await task.session();
  if (!accepted?.previousTurnId) throw new Error("Expected a saved prompt");
  expect(accepted.pendingMessage).toBeUndefined();
  expect(
    await task.backend.query(components.agent.messages.getMessagesByIds, {
      messageIds: [accepted.previousTurnId],
    }),
  ).toMatchObject([{ message: { role: "user", content: message } }]);
  await task.backend.mutation(internal.tasks.sessions.update, {
    sessionId: task.sessionId,
    active: false,
    state: { kind: "failed", error: "Generation failed after saving the prompt" },
  });
  await expect(
    task.owner.mutation(api.tasks.sessions.retryMessage, { sessionId: task.sessionId }),
  ).rejects.toThrow("not been submitted");
  expect((await task.session())?.previousTurnId).toBe(accepted.previousTurnId);
});

it("does not save or clear a Convex Agent follow-up when Stop wins before prompt persistence", async () => {
  const task = await setup("convex_agent");
  const before = await task.session();
  await task.owner.mutation(api.tasks.sessions.stop, { sessionId: task.sessionId });
  expect(
    await task.backend.mutation(internal.tasks.convexAgentRecords.prompt, {
      sessionId: task.sessionId,
      prompt: message,
      start: false,
    }),
  ).toBeNull();
  expect(await task.session()).toMatchObject({
    state: { kind: "stopped" },
    previousTurnId: before?.previousTurnId,
    pendingMessage: task.pendingMessage,
  });
});

it("cancels a newly accepted Agents turn when Stop and cleanup finish before its acknowledgement", async () => {
  const task = await setup("agents_api");
  const posted: unknown[] = [];
  let sessionReads = 0;
  const input = {
    events: [
      {
        type: "agent.session.input.message",
        input: [{ role: "user", content: messageContent }],
      },
    ],
  };
  const cancel = { events: [{ type: "agent.session.input.cancel" }] };
  const fetchMock = vi.fn<typeof fetch>(async (requestInput, init) => {
    const request = new Request(requestInput, init);
    const path = new URL(request.url).pathname;
    if (
      request.method === "GET" &&
      (path.endsWith("/sessions/session-test/turns") ||
        path.endsWith("/sessions/session-test/items"))
    )
      return Response.json({ data: [], has_more: false });
    if (request.method === "GET" && path.endsWith("/sessions/session-test/events"))
      return new Response("", { headers: { "Content-Type": "text/event-stream" } });
    if (request.method === "GET" && path.endsWith("/sessions/session-test")) {
      sessionReads++;
      return Response.json({ status: "idle" });
    }
    if (request.method === "POST" && path.endsWith("/sessions/session-test/events")) {
      const body: unknown = await request.json();
      posted.push(body);
      if (posted.length === 1) {
        expect(body).toEqual(input);
        expect((await task.session())?.pendingMessage?.status).toBe("submitting");
        await task.owner.mutation(api.tasks.sessions.stop, { sessionId: task.sessionId });
        await task.backend.mutation(internal.tasks.sessions.update, {
          sessionId: task.sessionId,
          active: false,
        });
      } else {
        expect(body).toEqual(cancel);
        expect((await task.session())?.pendingMessage).toBeUndefined();
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected provider request: ${request.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  await task.backend.action(internal.tasks.runtime.begin, {
    sessionId: task.sessionId,
    command: { kind: "send", message },
  });
  expect(posted).toEqual([input, cancel]);
  expect(sessionReads).toBe(0);
  expect(await task.session()).toMatchObject({ active: false, state: { kind: "stopped" } });
  expect((await task.session())?.pendingMessage).toBeUndefined();
  expect(
    (await task.owner.query(api.tasks.sessions.controls, { sessionId: task.sessionId }))
      .canRetryMessage,
  ).toBe(false);
  await expect(
    task.owner.mutation(api.tasks.sessions.retryMessage, { sessionId: task.sessionId }),
  ).rejects.toThrow("not been submitted");
  expect(posted).toEqual([input, cancel]);
});

it.each(["idle", "reconnected", "failed_twice"] as const)(
  "reads after an acknowledged transient stream failure without resubmitting: %s",
  async (outcome) => {
    const task = await setup("agents_api");
    const posted: unknown[] = [];
    let streamReads = 0;
    let sessionReads = 0;
    let itemReads = 0;
    const reply: AgentSessionAssistantMessage = {
      id: "reply",
      type: "message",
      turn_id: "accepted-turn",
      role: "assistant",
      phase: "final_answer",
      status: "completed",
      content: [{ type: "output_text", text: "Message received" }],
    };
    const recovered: AgentSessionAssistantMessage = {
      ...reply,
      id: "saved-reply",
      content: [{ type: "output_text", text: "Saved before reconnect" }],
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path.endsWith("/sessions/session-test/turns"))
        return Response.json({ data: [], has_more: false });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/items")) {
        itemReads++;
        return Response.json({ data: itemReads > 1 ? [recovered] : [], has_more: false });
      }
      if (request.method === "GET" && path.endsWith("/sessions/session-test")) {
        sessionReads++;
        expect(posted).toHaveLength(1);
        expect((await task.session())?.pendingMessage).toBeUndefined();
        return Response.json({ status: outcome === "idle" ? "idle" : "in_progress" });
      }
      if (request.method === "GET" && path.endsWith("/sessions/session-test/events")) {
        streamReads++;
        const event: AgentSessionEvent =
          streamReads === 1 || outcome === "failed_twice"
            ? {
                type: "error",
                event_id: `stream-error-${streamReads}`,
                session_id: "session-test",
                error: {
                  code: "internal_error",
                  type: "server_error",
                  param: null,
                  message: streamReads === 1 ? "Stream interrupted" : "Stream failed again",
                },
              }
            : {
                type: "agent.session.turn.item.done",
                event_id: "reply-done",
                session_id: "session-test",
                turn_id: "accepted-turn",
                output_index: 0,
                item: reply,
              };
        return new Response(`data: ${JSON.stringify(event)}\n\n`, {
          headers: {
            "Content-Type": "text/event-stream",
            "x-request-id": `req-reconnect-${streamReads}`,
          },
        });
      }
      if (request.method === "POST" && path.endsWith("/sessions/session-test/events")) {
        const body: unknown = await request.json();
        posted.push(body);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const begin = task.backend.action(internal.tasks.runtime.begin, {
      sessionId: task.sessionId,
      command: { kind: "send", message },
    });
    if (outcome === "failed_twice") {
      await expect(begin).rejects.toThrow("Stream failed again");
      expect((await task.session())?.state).toMatchObject({
        kind: "failed",
        diagnostic: {
          category: "transient_service",
          providerCode: "internal_error",
          requestId: "req-reconnect-2",
        },
      });
    } else {
      await expect(begin).resolves.toBe(true);
      expect((await task.session())?.state.kind).toBe("running");
    }
    expect(posted).toEqual([
      {
        events: [
          {
            type: "agent.session.input.message",
            input: [{ role: "user", content: messageContent }],
          },
        ],
      },
    ]);
    expect((await task.session())?.pendingMessage).toBeUndefined();
    expect(sessionReads).toBe(1);
    expect(streamReads).toBe(outcome === "idle" ? 1 : 2);
    expect(itemReads).toBe(outcome === "idle" ? 1 : 2);
    if (outcome === "reconnected") {
      const items = await task.backend.run((ctx) =>
        ctx.db
          .query("agentsApiItems")
          .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", task.sessionId))
          .take(10),
      );
      expect(items).toMatchObject([
        { providerItemId: "saved-reply", text: "Saved before reconnect" },
        { providerItemId: "reply", text: "Message received" },
      ]);
    }
  },
);
