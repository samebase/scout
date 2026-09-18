import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { openAIClient } from "./client";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("logs failed tool-result requests and each retry without exposing the tool output", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const accepted = vi.spyOn(console, "info").mockImplementation(() => {});
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { error: { message: "An internal error occurred.", code: "internal_error" } },
        { status: 500, headers: { "retry-after-ms": "1", "x-request-id": "req-failed" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(null, { status: 202, headers: { "x-request-id": "req-accepted" } }),
    );
  vi.stubGlobal("fetch", request);
  await openAIClient("task-test").beta.agents.sessions.events.create("session-test", {
    "Idempotency-Key": "task-test:turn-test:call-test",
    events: [
      {
        type: "agent.session.input.tool_result",
        turn_id: "turn-test",
        call_id: "call-test",
        success: true,
        output: "private browser content",
      },
    ],
  });
  expect(log).toHaveBeenCalledWith(
    "OpenAI request failed",
    expect.objectContaining({
      sessionId: "task-test",
      method: "POST",
      path: "/v1/agents/sessions/session-test/events",
      httpStatus: 500,
      requestId: "req-failed",
      retryCount: "0",
      events: [
        { type: "agent.session.input.tool_result", turn_id: "turn-test", call_id: "call-test" },
      ],
      error: { message: "An internal error occurred.", code: "internal_error" },
    }),
  );
  expect(accepted).toHaveBeenCalledWith(
    "OpenAI input accepted",
    expect.objectContaining({ httpStatus: 202, requestId: "req-accepted", retryCount: "1" }),
  );
  expect(
    request.mock.calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key")),
  ).toEqual(["task-test:turn-test:call-test", "task-test:turn-test:call-test"]);
  const logs = JSON.stringify([log.mock.calls, accepted.mock.calls]);
  expect(logs).not.toContain("private browser content");
  expect(logs).not.toContain("test-key");
});

it("logs the failing GET and transport error without its query or credentials", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")));
  await expect(
    openAIClient("task-test").beta.agents.sessions.items.list(
      "session-test",
      { after: "cursor-private" },
      { maxRetries: 0 },
    ),
  ).rejects.toThrow();
  expect(log).toHaveBeenCalledWith(
    "OpenAI request failed",
    expect.objectContaining({
      method: "GET",
      path: "/v1/agents/sessions/session-test/items",
      message: "fetch failed",
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("cursor-private");
  expect(JSON.stringify(log.mock.calls)).not.toContain("test-key");
});

function unavailable() {
  return Response.json(
    { error: { message: "The service is temporarily unavailable." } },
    { status: 503, headers: { "retry-after-ms": "1" } },
  );
}

it("recovers a session read after three transient HTTP failures", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(unavailable())
    .mockResolvedValueOnce(unavailable())
    .mockResolvedValueOnce(unavailable())
    .mockResolvedValueOnce(Response.json({ id: "session-test", status: "idle" }));
  vi.stubGlobal("fetch", request);

  const session = await openAIClient("task-test").beta.agents.sessions.retrieve("session-test");
  expect(session).toMatchObject({ id: "session-test", status: "idle" });

  expect(request).toHaveBeenCalledTimes(4);
  expect(
    request.mock.calls.map(([, init]) => new Headers(init?.headers).get("x-stainless-retry-count")),
  ).toEqual(["0", "1", "2", "3"]);
});

it("surfaces a persistent failure after the initial attempt and three retries", async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => unavailable());
  vi.stubGlobal("fetch", request);

  await expect(
    openAIClient("task-test").beta.agents.sessions.retrieve("session-test"),
  ).rejects.toMatchObject({ status: 503 });

  expect(request).toHaveBeenCalledTimes(4);
});

it("does not retry an authentication rejection", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ error: { message: "Invalid API key" } }, { status: 401 }),
    );
  vi.stubGlobal("fetch", request);

  await expect(
    openAIClient("task-test").beta.agents.sessions.retrieve("session-test"),
  ).rejects.toMatchObject({ status: 401 });

  expect(request).toHaveBeenCalledOnce();
});
