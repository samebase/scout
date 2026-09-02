import { tool } from "ai";
import { z } from "zod";

const toolArgumentProbeSchema = z
  .object({
    stringValue: z.unknown().describe('Send the JSON string "plain text"'),
    numberValue: z.unknown().describe("Send the JSON number 42"),
    booleanValue: z.unknown().describe("Send the JSON boolean true"),
    objectValue: z.unknown().describe('Send the JSON object {"label":"nested","count":2}'),
    arrayValue: z.unknown().describe('Send the JSON array ["alpha","beta"]'),
    nullValue: z.unknown().describe("Send the JSON null value"),
  })
  .strict();

function jsonType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function createToolArgumentProbe() {
  return tool({
    description:
      "Developer-only provider probe. Call with the exact JSON values described by each field. It reports the argument types received by Scout without normalizing them.",
    inputSchema: toolArgumentProbeSchema,
    execute: async (input) => ({
      received: Object.fromEntries(
        Object.entries(input).map(([name, value]) => [name, { type: jsonType(value), value }]),
      ),
    }),
  });
}
