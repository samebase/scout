import { describe, expect, it, vi } from "vite-plus/test";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "./agentMail";

const identity = {
  apiKey: "agentmail-secret",
  inboxId: "conrad+tasks@agentmail.to",
};
const inboxAddress = "conrad+tasks@agentmail.to";

function inboxResponse(overrides: { inboxId?: string; address?: string } = {}) {
  return new Response(
    JSON.stringify({
      inbox_id: overrides.inboxId ?? identity.inboxId,
      email: overrides.address ?? inboxAddress,
    }),
    { status: 200 },
  );
}

function sentResponse(messageId = "message-1", threadId = "thread-1") {
  return new Response(JSON.stringify({ message_id: messageId, thread_id: threadId }), {
    status: 200,
  });
}

function requestBody(init: RequestInit | undefined) {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  const body: unknown = JSON.parse(init.body);
  return body;
}

describe("AgentMail inbox client", () => {
  it("verifies registration identity and sends with an idempotency key", async () => {
    const request = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) => sentResponse())
      .mockResolvedValueOnce(inboxResponse());
    const timeoutSignal = vi.fn((_milliseconds: number) => new AbortController().signal);
    const client = createAgentMailInboxClient(identity, { fetch: request, timeoutSignal });
    const controller = new AbortController();

    await client.verifyAddress(inboxAddress, { signal: controller.signal });
    await expect(
      client.send(
        {
          to: "operator@gmail.com",
          subject: "A question",
          text: "Could you check this?",
          idempotencyKey: "scout.send.logical-request-1",
        },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({ messageId: "message-1", threadId: "thread-1" });

    const [lookupUrl, lookupInit] = request.mock.calls[0] ?? [];
    expect(lookupUrl).toBe("https://api.agentmail.to/v0/inboxes/conrad%2Btasks%40agentmail.to");
    expect(lookupInit).toMatchObject({ headers: { Authorization: "Bearer agentmail-secret" } });
    expect(lookupInit?.signal).toBeInstanceOf(AbortSignal);
    const [sendUrl, sendInit] = request.mock.calls[1] ?? [];
    expect(sendUrl).toBe(
      "https://api.agentmail.to/v0/inboxes/conrad%2Btasks%40agentmail.to/messages/send",
    );
    expect(sendInit).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer agentmail-secret",
        "Content-Type": "application/json",
        "Idempotency-Key": "scout.send.logical-request-1",
      },
    });
    expect(sendInit?.signal).toBeInstanceOf(AbortSignal);
    expect(requestBody(sendInit)).toEqual({
      to: ["operator@gmail.com"],
      subject: "A question",
      text: "Could you check this?",
    });
    expect(timeoutSignal).toHaveBeenCalledTimes(4);
    expect(timeoutSignal).toHaveBeenNthCalledWith(1, 30_000);
    expect(timeoutSignal).toHaveBeenNthCalledWith(2, 15_000);
    expect(timeoutSignal).toHaveBeenNthCalledWith(3, 30_000);
    expect(timeoutSignal).toHaveBeenNthCalledWith(4, 15_000);
    controller.abort();
    expect(lookupInit?.signal?.aborted).toBe(true);
    expect(sendInit?.signal?.aborted).toBe(true);
  });

  it("retries an ambiguous send with the same body and idempotency key", async () => {
    const request = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) => sentResponse())
      .mockRejectedValueOnce(new TypeError("connection reset"));
    const client = createAgentMailInboxClient(identity, { fetch: request });

    await expect(
      client.send({
        to: "operator@gmail.com",
        subject: "A question",
        text: "Could you check this?",
        idempotencyKey: "scout.send.logical-request-1",
      }),
    ).resolves.toEqual({ messageId: "message-1", threadId: "thread-1" });

    expect(request).toHaveBeenCalledTimes(2);
    const [, firstAttempt] = request.mock.calls[0] ?? [];
    const [, retryAttempt] = request.mock.calls[1] ?? [];
    expect(firstAttempt?.headers).toEqual(retryAttempt?.headers);
    expect(firstAttempt?.body).toBe(retryAttempt?.body);
  });

  it("does not retry a definitive provider rejection", async () => {
    const request = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: "rejected" }), { status: 400 }),
    );
    const client = createAgentMailInboxClient(identity, { fetch: request });

    await expect(
      client.send({
        to: "operator@gmail.com",
        subject: "A question",
        text: "Could you check this?",
        idempotencyKey: "scout.send.logical-request-1",
      }),
    ).rejects.toThrow("AgentMail send failed (400)");
    expect(request).toHaveBeenCalledOnce();
  });

  it("honors a rate-limit retry delay before retrying", async () => {
    const request = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) => sentResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      );
    const client = createAgentMailInboxClient(identity, { fetch: request });

    await expect(
      client.send({
        to: "operator@gmail.com",
        subject: "A question",
        text: "Could you check this?",
        idempotencyKey: "scout.send.logical-request-1",
      }),
    ).resolves.toEqual({ messageId: "message-1", threadId: "thread-1" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reuses inbox verification and binds replies to the configured inbox", async () => {
    const request = vi
      .fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        sentResponse("reply-1", "thread-2"),
      )
      .mockResolvedValueOnce(inboxResponse());
    const client = createAgentMailInboxClient(identity, { fetch: request });

    await client.verifyAddress(inboxAddress);
    await expect(
      client.reply({
        messageId: "gmail/message-1",
        text: "Thanks, that answers it.",
        idempotencyKey: "scout.reply.logical-request-1",
      }),
    ).resolves.toEqual({ messageId: "reply-1", threadId: "thread-2" });

    expect(request).toHaveBeenCalledTimes(2);
    const [replyUrl, replyInit] = request.mock.calls[1] ?? [];
    expect(replyUrl).toBe(
      "https://api.agentmail.to/v0/inboxes/conrad%2Btasks%40agentmail.to/messages/gmail%2Fmessage-1/reply",
    );
    expect(requestBody(replyInit)).toEqual({ text: "Thanks, that answers it.", reply_all: false });
  });

  it("fails closed when the provider inbox does not match the configured address", async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      inboxResponse({ address: "someone-else@agentmail.to" }),
    );
    const client = createAgentMailInboxClient(identity, { fetch: request });

    await expect(client.verifyAddress(inboxAddress)).rejects.toThrow(
      "inbox ID and address do not identify the same inbox",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects malformed provider responses and invalid idempotency keys", async () => {
    const invalidResponse = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ inbox_id: "x" })),
    );
    await expect(
      createAgentMailInboxClient(identity, { fetch: invalidResponse }).verifyAddress(inboxAddress),
    ).rejects.toThrow("inbox lookup returned an invalid response");

    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      inboxResponse(),
    );
    await expect(
      createAgentMailInboxClient(identity, { fetch: request }).send({
        to: "operator@gmail.com",
        subject: "A question",
        text: "Could you check this?",
        idempotencyKey: "not allowed",
      }),
    ).rejects.toThrow("idempotency key is invalid");
    expect(request).not.toHaveBeenCalled();
    expect(() => requiredAgentMailApiKey("  ")).toThrow("AGENTMAIL_API_KEY");
  });
});
