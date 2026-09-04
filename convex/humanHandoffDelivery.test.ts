import { describe, expect, test, vi } from "vite-plus/test";
import { runHumanHandoffDelivery } from "./humanHandoffDelivery";
import {
  createAgentMailInboxClient,
  type AgentMailRequestOptions,
  type AgentMailSendMessage,
} from "./scout/lib/agentMail";

const delivery = {
  handoffId: "handoff-1",
  inboxId: "conrad@agentmail.to",
  recipientEmail: "operator@example.test",
  scoutName: "Conrad Scout",
  handoffUrl: "https://scout.example/handoff/handoff-1#access=private",
};

const ready = async () => ({ kind: "ready" as const, claimExpiresAt: 20_000 });

describe("human handoff email delivery", () => {
  test("sends the server-rendered handoff email within one total deadline", async () => {
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const sendEmail = vi.fn(
      async (_message: AgentMailSendMessage, _options?: AgentMailRequestOptions) => ({
        messageId: "message-1",
        threadId: "thread-1",
      }),
    );

    await expect(
      runHumanHandoffDelivery(delivery, {
        prepare: ready,
        sendEmail,
        now: () => 1_000,
        timeoutSignal,
      }),
    ).resolves.toEqual({ kind: "sent" });
    expect(timeoutSignal).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: delivery.recipientEmail,
        subject: "[Scout human check] Conrad Scout needs your help",
        idempotencyKey: "scout-handoff-handoff-1",
      }),
      { signal },
    );
  });

  test("throws ambiguous failures so the durable workflow retries the same delivery", async () => {
    const sendEmail = vi.fn(
      async (_message: AgentMailSendMessage, _options?: AgentMailRequestOptions) => {
        throw new TypeError("response lost");
      },
    );

    await expect(
      runHumanHandoffDelivery(delivery, { prepare: ready, sendEmail, now: () => 1_000 }),
    ).rejects.toThrow("response lost");
  });

  test("returns a definitive failure for a rejected provider request", async () => {
    const client = createAgentMailInboxClient(
      { apiKey: "secret", inboxId: delivery.inboxId },
      {
        fetch: vi.fn(
          async () => new Response(JSON.stringify({ error: "rejected" }), { status: 400 }),
        ),
      },
    );

    await expect(
      runHumanHandoffDelivery(delivery, {
        prepare: ready,
        sendEmail: client.send,
        now: () => 1_000,
      }),
    ).resolves.toEqual({ kind: "definitive_failure" });
  });

  test("does not send after the handoff stops accepting delivery", async () => {
    const sendEmail = vi.fn(
      async (_message: AgentMailSendMessage, _options?: AgentMailRequestOptions) => ({
        messageId: "message-1",
        threadId: "thread-1",
      }),
    );

    await expect(
      runHumanHandoffDelivery(delivery, {
        prepare: async () => ({ kind: "skipped" as const }),
        sendEmail,
      }),
    ).resolves.toEqual({ kind: "skipped" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
