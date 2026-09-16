import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { openAIClient } from "./client";
import { client as componentClient } from "../components/openaiAgents/client";

const clients = [openAIClient, componentClient];

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", "test-webhook-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function unavailable() {
  return Response.json(
    { error: { message: "The service is temporarily unavailable." } },
    { status: 503, headers: { "retry-after-ms": "1" } },
  );
}

it.each(clients)(
  "recovers session creation after three transient HTTP failures: %s",
  async (client) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(
        new Response('data: {"type":"agent.session.created","session":{"id":"session-test"}}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", request);

    const stream = await client().beta.agents.sessions.create({
      environment: { type: "none" },
      stream: true,
    });
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([{ type: "agent.session.created", session: { id: "session-test" } }]);

    expect(request).toHaveBeenCalledTimes(4);
    expect(
      request.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("x-stainless-retry-count"),
      ),
    ).toEqual(["0", "1", "2", "3"]);
    expect(new Set(request.mock.calls.map(([, init]) => init?.body)).size).toBe(1);
  },
);

it.each(clients)(
  "surfaces a persistent failure after the initial attempt and three retries: %s",
  async (client) => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => unavailable());
    vi.stubGlobal("fetch", request);

    await expect(
      client().beta.agents.sessions.create({ environment: { type: "none" }, stream: true }),
    ).rejects.toMatchObject({ status: 503 });

    expect(request).toHaveBeenCalledTimes(4);
  },
);

it.each(clients)("does not retry an authentication rejection: %s", async (client) => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ error: { message: "Invalid API key" } }, { status: 401 }),
    );
  vi.stubGlobal("fetch", request);

  await expect(
    client().beta.agents.sessions.create({ environment: { type: "none" }, stream: true }),
  ).rejects.toMatchObject({ status: 401 });

  expect(request).toHaveBeenCalledOnce();
});
