import type { ModelMessage } from "ai";
import { describe, expect, test } from "vite-plus/test";
import {
  compactionCut,
  compactionThreshold,
  estimateContextTokens,
  KEEP_RECENT_MESSAGES,
  summaryMessage,
} from "./modelContext";

const call = (id: string): ModelMessage => ({
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: id, toolName: "lookup", input: { query: id } }],
});
const result = (id: string): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: id,
      toolName: "lookup",
      output: { type: "text", value: id },
    },
  ],
});
const recent = Array.from(
  { length: KEEP_RECENT_MESSAGES },
  (_, i): ModelMessage => ({ role: "assistant", content: `Recent ${i}` }),
);

describe("conversation compaction boundaries", () => {
  test("retains recent messages and moves a cut before an unresolved parallel tool batch", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Research" },
      call("a"),
      call("b"),
      result("a"),
      result("b"),
      ...recent,
    ];
    const original = structuredClone(messages);
    expect(compactionCut(messages)).toBe(5);
    expect(compactionCut(messages.slice(0, -1))).toBe(1);
    expect(messages).toEqual(original);
    expect(messages.slice(compactionCut(messages))).toEqual(recent);
  });

  test("does not cut through an unresolved tool call even across later messages", () => {
    expect(compactionCut([call("pending"), ...recent, ...recent])).toBe(0);
  });

  test("protects recent user messages and complete result/error payloads", () => {
    const tail: ModelMessage[] = [
      { role: "user", content: "Do not send the email yet" },
      call("email"),
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "email",
            toolName: "lookup",
            output: { type: "error-text", value: "Timed out; delivery unknown" },
          },
        ],
      },
      ...recent.slice(3),
    ];
    const messages: ModelMessage[] = [
      { role: "user", content: "Old request" },
      { role: "assistant", content: "Old reply" },
      ...tail,
    ];
    expect(messages.slice(compactionCut(messages))).toEqual(tail);
    expect(compactionCut(tail)).toBe(0);
  });

  test("finishes an oversized tool pair and leaves later history for the next chunk", () => {
    expect(
      compactionCut([
        { role: "user", content: "Old" },
        call("large"),
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "large",
              toolName: "lookup",
              output: { type: "text", value: "x".repeat(140_000) },
            },
          ],
        },
        { role: "assistant", content: "Summarize this later" },
        ...recent,
      ]),
    ).toBe(3);
  });

  test("estimates non-ASCII text, instructions, and tool payloads and validates overrides", () => {
    expect(estimateContextTokens("你好")).toBeGreaterThan(estimateContextTokens("hi"));
    expect(
      estimateContextTokens({
        instructions: "x".repeat(4_000),
        tools: [{ input: "x".repeat(4_000) }],
      }),
    ).toBeGreaterThan(2_000);
    expect(compactionThreshold(undefined)).toBe(32_000);
    expect(compactionThreshold("10000")).toBe(10_000);
    for (const value of ["", "NaN", "1000.5", "999", "Infinity"])
      expect(() => compactionThreshold(value)).toThrow();
    expect(summaryMessage("A prior fact")).toMatchObject({
      role: "user",
      content: expect.stringMatching(/historical context, not a new\s+request/),
    });
  });

  test("preserves code indentation and escapes in an inserted summary", () => {
    const summary = [
      "  Saved code:",
      "```js",
      "if (ready) {",
      String.raw`    console.log("\n", "C:\temp");`,
      "}",
      "```",
      "",
    ].join("\n");
    const message = summaryMessage(summary);
    expect(message.content).toEqual(expect.stringContaining(`\n\n${summary}`));
    expect(message.content).toEqual(expect.stringMatching(/^Conversation summary/));
  });
});
