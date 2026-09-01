import { describe, expect, it } from "vite-plus/test";
import {
  decideTaskStep,
  createSingleUseAttemptResolutionArm,
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
        stepNumber: 5,
        normalCloseStep: 18,
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
    stepNumber = 5,
  ) {
    return decideTaskStep({
      state,
      previousToolResult,
      stepNumber,
      normalCloseStep: 18,
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

  it("forces one outcome after a successful ordinary browser close", () => {
    const close = decide("working", { toolName: "browser_close", output: { success: true } });
    expect(close).toEqual({ kind: "resolve_attempt", nextState: "resolving" });
    expect(
      decide(close.nextState, {
        toolName: "resolve_attempt",
        output: { kind: "blocked", conclusion: "The gate remained", resolvedAt: 1 },
      }),
    ).toEqual({ kind: "final", nextState: "final", humanHelpOutcome: "none" });
  });

  it("does not resolve after an unsuccessful browser close", () => {
    expect(decide("closing", { toolName: "browser_close", output: { success: false } })).toEqual({
      kind: "final",
      nextState: "final",
      humanHelpOutcome: "none",
    });
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
        stepNumber: 20,
        normalCloseStep: 18,
        previousToolResult: null,
        previousToolError: immediatelyPrecedingToolError(steps),
      }),
    ).toEqual({ kind: "resolution_failed", nextState: "final" });
  });

  it("keeps the ordinary cost-neutral close at step 18", () => {
    expect(decide("working", null, 18)).toEqual({
      kind: "browser_close",
      nextState: "closing",
    });
  });

  it("arms exactly one post-close attempt resolution", () => {
    const arm = createSingleUseAttemptResolutionArm();

    expect(arm.consume()).toBe(false);
    arm.arm();
    expect(arm.consume()).toBe(true);
    expect(arm.consume()).toBe(false);
  });
});
