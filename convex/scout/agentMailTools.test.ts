import { describe, expect, it, vi } from "vite-plus/test";
import type { AgentMailSendMessage } from "./lib/agentMail";
import { agentMailIdempotencyKey, createAgentMailWriteTools } from "./agentMailTools";

const toolOptions = {
  toolCallId: "tool-call-1",
  messages: [],
  context: undefined,
  abortSignal: new AbortController().signal,
};
const inboxId = "conrad@agentmail.to";

describe("AgentMail write tools", () => {
  it("lets Scout compose a message while keeping delivery bound to the server client", async () => {
    const send = vi.fn(async () => ({ messageId: "message-1", threadId: "thread-1" }));
    const tools = createAgentMailWriteTools(
      { inboxId, send, reply: vi.fn() },
      { kind: "model", promptMessageId: "prompt-1" },
    );
    const input = { to: "person@gmail.com", subject: "Hello", text: "A note from Scout." };

    await expect(tools.send_message.execute(input, toolOptions)).resolves.toEqual({
      status: "sent",
      messageId: "message-1",
      threadId: "thread-1",
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      {
        ...input,
        idempotencyKey: agentMailIdempotencyKey(
          "send",
          `${inboxId}\0prompt-1\0tool-call-1\0${JSON.stringify(input)}`,
        ),
      },
      { signal: toolOptions.abortSignal },
    );
  });

  it("replies by message ID with a stable operation-specific key", async () => {
    const reply = vi.fn(async () => ({ messageId: "reply-1", threadId: "thread-1" }));
    const tools = createAgentMailWriteTools(
      { inboxId, send: vi.fn(), reply },
      { kind: "model", promptMessageId: "prompt-1" },
    );
    const input = { messageId: "message-1", text: "Thanks for the update." };

    await expect(tools.reply_to_message.execute(input, toolOptions)).resolves.toEqual({
      status: "sent",
      messageId: "reply-1",
      threadId: "thread-1",
    });
    expect(reply).toHaveBeenCalledExactlyOnceWith(
      {
        ...input,
        idempotencyKey: agentMailIdempotencyKey(
          "reply",
          `${inboxId}\0prompt-1\0tool-call-1\0${JSON.stringify(input)}`,
        ),
      },
      { signal: toolOptions.abortSignal },
    );
    expect(agentMailIdempotencyKey("reply", "logical-request")).not.toBe(
      agentMailIdempotencyKey("send", "logical-request"),
    );
  });

  it("keeps a manual operation idempotent across action retries", async () => {
    const send = vi.fn(async (_message: AgentMailSendMessage) => ({
      messageId: "message-1",
      threadId: "thread-1",
    }));
    const tools = createAgentMailWriteTools(
      { inboxId, send, reply: vi.fn() },
      { kind: "manual", operationId: "manual-operation-1" },
    );
    const input = { to: "person@gmail.com", subject: "Hello", text: "A note from Scout." };

    await tools.send_message.execute(input, toolOptions);
    await tools.send_message.execute(input, { ...toolOptions, toolCallId: "retry-tool-call" });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].idempotencyKey).toBe(send.mock.calls[1]?.[0].idempotencyKey);
  });
});
