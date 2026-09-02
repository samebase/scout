import { describe, expect, it } from "vite-plus/test";
import {
  decideTaskStep,
  detectsHumanGate,
  immediatelyPrecedingToolError,
  immediatelyPrecedingToolResult,
  type TaskLoopState,
} from "./taskLoop";

const dataDomeOutput = {
  output:
    '- Iframe "DataDome Device Check" [ref=e1]\n  - button "Switch to the visual verification" ...',
};

describe("task human gate detection", () => {
  it("recognizes the real DataDome browser snapshot", () => {
    expect(detectsHumanGate(dataDomeOutput)).toBe(true);
  });

  it.each([
    "CAPTCHA challenge",
    "hCaptcha challenge",
    "reCAPTCHA challenge",
    "Verify you are human",
    "verify-you-are-human",
    "Verify that you're a human",
    "Human checkpoint",
    "Human verification required",
    "Device verification",
  ])("recognizes %s", (output) => {
    expect(detectsHumanGate({ output })).toBe(true);
  });

  it("ignores identical text outside the immediately preceding browser result", () => {
    const steps = [
      {
        text: 'Iframe "DataDome Device Check" from the user prompt',
        toolResults: [
          {
            toolName: "browser_execute",
            output: { output: '- heading "Create your account"' },
          },
        ],
      },
    ];

    const previous = immediatelyPrecedingToolResult(steps);
    expect(previous?.output).toEqual({ output: '- heading "Create your account"' });
    expect(detectsHumanGate(previous?.output)).toBe(false);
  });

  it("does not trigger on a non-browser tool result containing the same DataDome text", () => {
    expect(
      decideTaskStep({
        state: "working",
        previousToolResult: { toolName: "get_thread", output: dataDomeOutput },
      }),
    ).toEqual({ kind: "none", nextState: "working" });
  });

  it("uses the last relevant result in the last step when AgentMail also ran", () => {
    const previous = immediatelyPrecedingToolResult([
      {
        toolResults: [
          { toolName: "browser_execute", output: dataDomeOutput },
          { toolName: "get_thread", output: dataDomeOutput },
        ],
      },
    ]);

    expect(previous).toEqual({ toolName: "browser_execute", output: dataDomeOutput });
  });

  it("does not scan an older step for a human gate", () => {
    expect(
      immediatelyPrecedingToolResult([
        { toolResults: [{ toolName: "browser_execute", output: dataDomeOutput }] },
        { toolResults: [{ toolName: "get_thread", output: { output: "mail" } }] },
      ]),
    ).toBeNull();
  });
});

describe("task loop decisions", () => {
  function decide(
    state: TaskLoopState,
    previousToolResult: { toolName: string; output: unknown } | null,
  ) {
    return decideTaskStep({
      state,
      previousToolResult,
    });
  }

  it("forces human help immediately after a browser result exposes a gate", () => {
    expect(decide("working", { toolName: "browser_execute", output: dataDomeOutput })).toEqual({
      kind: "request_human_help",
      nextState: "final",
    });
  });

  it("stops after the model requests human help", () => {
    expect(
      decide("working", {
        toolName: "request_human_help",
        output: { status: "waiting" },
      }),
    ).toEqual({ kind: "final", nextState: "final", humanHelpOutcome: "waiting" });
  });

  it("finishes after a persisted Attempt resolution", () => {
    expect(
      decide("working", {
        toolName: "resolve_attempt",
        output: { kind: "blocked", conclusion: "The gate remained", resolvedAt: 1 },
      }),
    ).toEqual({ kind: "final", nextState: "final", humanHelpOutcome: "none" });
  });

  it("resolves after browser startup exhausts its internal retries", () => {
    expect(
      decideTaskStep({
        state: "working",
        previousToolResult: null,
        previousToolError: { toolName: "browser_open" },
      }),
    ).toEqual({ kind: "resolve_attempt", nextState: "resolving" });
  });

  it("fails instead of completing when attempt resolution errors", () => {
    const steps = [
      {
        toolResults: [],
        content: [
          {
            type: "tool-error",
            toolName: "resolve_attempt",
          },
        ],
      },
    ];
    expect(immediatelyPrecedingToolError(steps)).toEqual({ toolName: "resolve_attempt" });
    expect(
      decideTaskStep({
        state: "resolving",
        previousToolResult: null,
        previousToolError: immediatelyPrecedingToolError(steps),
      }),
    ).toEqual({ kind: "resolution_failed", nextState: "final" });
  });

  it("does not preempt ordinary browser work before the generation hard limit", () => {
    expect(decide("working", null)).toEqual({ kind: "none", nextState: "working" });
  });
});
