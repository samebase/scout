import { describe, expect, it } from "vite-plus/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { streamText, tool } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { repairStringifiedToolInput, repairStringifiedTopLevelValues } from "./toolCallRepair";

const mixedInputSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    count: { type: "integer" },
    enabled: { type: "boolean" },
    target: {
      oneOf: [
        { type: "object", properties: { kind: { const: "role" } } },
        { type: "object", properties: { kind: { const: "label" } } },
      ],
    },
    tags: { type: "array", items: { type: "string" } },
    empty: { type: "null" },
  },
};

describe("Scout tool-call repair", () => {
  it("decodes only stringified values whose declared type is not string", () => {
    expect(
      repairStringifiedTopLevelValues(
        {
          text: "123",
          count: "30",
          enabled: "true",
          target: '{"kind":"role"}',
          tags: '["alpha","beta"]',
          empty: "null",
        },
        mixedInputSchema,
      ),
    ).toEqual({
      input: {
        text: "123",
        count: 30,
        enabled: true,
        target: { kind: "role" },
        tags: ["alpha", "beta"],
        empty: null,
      },
      fields: ["count", "enabled", "target", "tags", "empty"],
    });
  });

  it("does not decode a value when the property accepts strings", () => {
    expect(
      repairStringifiedTopLevelValues(
        { value: "42" },
        {
          type: "object",
          properties: { value: { oneOf: [{ type: "string" }, { type: "number" }] } },
        },
      ),
    ).toBeNull();
  });

  it("leaves malformed JSON for the original validator to reject", () => {
    expect(repairStringifiedTopLevelValues({ count: "thirty" }, mixedInputSchema)).toBeNull();
  });

  it("keeps repair metadata on the UI message stream", async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "example",
            input: JSON.stringify({ count: "30" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ] satisfies LanguageModelV4StreamPart[]),
      },
    });
    const result = streamText({
      model,
      tools: {
        example: tool({
          inputSchema: z.object({ count: z.number() }),
          execute: async ({ count }) => count,
        }),
      },
      repairToolCall: repairStringifiedToolInput,
      prompt: "Call the example tool",
    });
    const chunks = [];
    for await (const chunk of result.toUIMessageStream()) chunks.push(chunk);

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        providerMetadata: {
          scout: {
            inputRepair: {
              method: "json-parse",
              fields: ["count"],
            },
          },
        },
      }),
    );
  });
});
