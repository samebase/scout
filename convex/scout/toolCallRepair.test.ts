import { describe, expect, it } from "vite-plus/test";
import { repairStringifiedTopLevelValues } from "./toolCallRepair";

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
      text: "123",
      count: 30,
      enabled: true,
      target: { kind: "role" },
      tags: ["alpha", "beta"],
      empty: null,
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
});
