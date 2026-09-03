import { describe, expect, it } from "vitest";
import {
  browserBridgeRequestSchema,
  parseLoopbackRunnerUrl,
  runnerSecretFromHash,
} from "./scoutRunnerProtocol";

describe("Scout runner protocol", () => {
  it("accepts only loopback HTTP runner URLs", () => {
    expect(parseLoopbackRunnerUrl("http://127.0.0.1:43123/")?.origin).toBe(
      "http://127.0.0.1:43123",
    );
    expect(parseLoopbackRunnerUrl("https://127.0.0.1:43123/")).toBeNull();
    expect(parseLoopbackRunnerUrl("http://example.com:43123/")).toBeNull();
    expect(parseLoopbackRunnerUrl("http://127.0.0.1:43123/path")).toBeNull();
  });

  it("keeps the pairing secret in the URL fragment", () => {
    const secret = "a".repeat(43);
    expect(runnerSecretFromHash(`#scout-runner=${secret}`)).toBe(secret);
    expect(runnerSecretFromHash("#scout-runner=short")).toBeNull();
  });

  it("rejects non-Scout tool calls at the browser boundary", () => {
    expect(() =>
      browserBridgeRequestSchema.parse({
        kind: "callTool",
        requestId: crypto.randomUUID(),
        threadId: "thread",
        promptMessageId: "prompt",
        toolName: "exec_command",
        input: {},
      }),
    ).toThrow();
  });

  it("requires a saved prompt for preparation and chat-bound runner requests", () => {
    expect(() =>
      browserBridgeRequestSchema.parse({
        kind: "prepare",
        requestId: crypto.randomUUID(),
        scoutSlug: "conrad",
      }),
    ).toThrow();
    expect(
      browserBridgeRequestSchema.parse({
        kind: "finish",
        requestId: crypto.randomUUID(),
        threadId: "thread",
        promptMessageId: "prompt",
        outcome: { kind: "completed", response: "Done" },
      }),
    ).toMatchObject({ kind: "finish", promptMessageId: "prompt" });
  });
});
