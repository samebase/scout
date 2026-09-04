import { describe, expect, test } from "vite-plus/test";
import { parseModelInputSnapshot } from "./scout-model-input";

describe("SDK model input snapshot", () => {
  test("parses the captured versioned JSON boundary", () => {
    expect(
      parseModelInputSnapshot(
        JSON.stringify({
          version: 1,
          instructions: "Inspect carefully.",
          messages: [{ role: "user", content: "Inspect this." }],
          tools: [{ name: "browser_execute" }],
          settings: { temperature: 0 },
        }),
      ),
    ).toEqual({
      version: 1,
      instructions: "Inspect carefully.",
      messages: [{ role: "user", content: "Inspect this." }],
      tools: [{ name: "browser_execute" }],
      settings: { temperature: 0 },
    });
  });

  test("rejects malformed and unsupported snapshots", () => {
    expect(parseModelInputSnapshot("not JSON")).toBeNull();
    expect(
      parseModelInputSnapshot(
        JSON.stringify({
          version: 2,
          instructions: null,
          messages: [],
          tools: null,
          settings: {},
        }),
      ),
    ).toBeNull();
  });
});
