import { describe, expect, it } from "vite-plus/test";
import { createToolArgumentProbe } from "./toolArgumentProbe";

describe("Scout tool argument probe", () => {
  it("reports the raw JSON types it receives", async () => {
    const probe = createToolArgumentProbe();
    const input = {
      stringValue: "plain text",
      numberValue: "42",
      booleanValue: true,
      objectValue: '{"label":"nested","count":2}',
      arrayValue: ["alpha", "beta"],
      nullValue: null,
    };

    await expect(
      probe.execute(input, {
        toolCallId: "probe-1",
        messages: [],
        context: {},
      }),
    ).resolves.toEqual({
      received: {
        stringValue: { type: "string", value: "plain text" },
        numberValue: { type: "string", value: "42" },
        booleanValue: { type: "boolean", value: true },
        objectValue: { type: "string", value: '{"label":"nested","count":2}' },
        arrayValue: { type: "array", value: ["alpha", "beta"] },
        nullValue: { type: "null", value: null },
      },
    });
  });
});
