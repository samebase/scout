import type { ModelMessage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { compactCompletedTurnContext } from "./modelContext";

describe("Scout model context", () => {
  it("keeps the request and final answer from a completed turn", () => {
    const messages = [
      { role: "user", content: "Create the app" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll click the button." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "browser_execute",
            input: { code: "await page.getByRole('button').click()" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "browser_execute",
            output: { type: "text", value: "Created app-123" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "I should report the durable result." },
          { type: "text", text: "Created app-123 at https://app.example.test." },
        ],
      },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual([
      messages[0],
      {
        role: "assistant",
        content: [{ type: "text", text: "Created app-123 at https://app.example.test." }],
      },
    ]);
  });

  it("keeps non-trace parts and provider options from the final answer", () => {
    const messages = [
      { role: "user", content: "Create the report" },
      {
        role: "assistant",
        providerOptions: { test: { message: "preserved" } },
        content: [
          { type: "reasoning", text: "Hidden analysis" },
          {
            type: "reasoning-file",
            data: { type: "data", data: "hidden" },
            mediaType: "text/plain",
          },
          { type: "text", text: "Created the report." },
          {
            type: "file",
            data: { type: "data", data: "report" },
            mediaType: "text/plain",
            filename: "report.txt",
          },
          { type: "custom", kind: "test.result" },
        ],
      },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual([
      messages[0],
      {
        role: "assistant",
        providerOptions: { test: { message: "preserved" } },
        content: [
          { type: "text", text: "Created the report." },
          {
            type: "file",
            data: { type: "data", data: "report" },
            mediaType: "text/plain",
            filename: "report.txt",
          },
          { type: "custom", kind: "test.result" },
        ],
      },
    ]);
  });

  it("keeps an unfinished turn intact when it has no final answer", () => {
    const messages = [
      { role: "user", content: "Delete the app" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "browser_execute",
            input: { code: "await page.getByRole('button').click()" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "browser_execute",
            output: { type: "text", value: "Deletion state is unknown" },
          },
        ],
      },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual(messages);
  });

  it("compacts completed turns without touching a later unfinished turn", () => {
    const messages = [
      { role: "user", content: "Create the app" },
      { role: "assistant", content: "Created app-123." },
      { role: "user", content: "Delete it" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-2",
            toolName: "browser_execute",
            input: { code: "await page.goto('https://example.test')" },
          },
        ],
      },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual(messages);
  });

  it("keeps a final assistant message with a tool call intact", () => {
    const messages = [
      { role: "user", content: "Create the app" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "One more operation is required." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "browser_execute",
            input: { code: "await page.reload()" },
          },
        ],
      },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual(messages);
  });

  it("keeps structurally ambiguous and response-only history intact", () => {
    const messages = [
      { role: "assistant", content: "Tail of a turn outside the fetched window." },
      { role: "user", content: "First request" },
      { role: "system", content: "Inserted context" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second request" },
      { role: "assistant", content: "Second answer" },
    ] satisfies ModelMessage[];

    expect(compactCompletedTurnContext(messages)).toEqual(messages);
  });

  it("is immutable and idempotent", () => {
    const messages = [
      { role: "user", content: "Create the app" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Hidden analysis" },
          { type: "text", text: "Created app-123." },
        ],
      },
    ] satisfies ModelMessage[];
    const before = structuredClone(messages);
    const compacted = compactCompletedTurnContext(messages);

    expect(messages).toEqual(before);
    expect(compactCompletedTurnContext(compacted)).toEqual(compacted);
  });
});
