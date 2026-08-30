import { describe, expect, it } from "vite-plus/test";
import {
  decideClaimTestStep,
  createSingleUseHumanHandoffArm,
  detectsHumanGate,
  immediatelyPrecedingToolResult,
  type ClaimTestLoopState,
} from "./claimTestLoop";

const dataDomeOutput = {
  output:
    '- Iframe "DataDome Device Check" [ref=e1]\n  - button "Switch to the visual verification" ...',
};

describe("claim-test human gate detection", () => {
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
            toolName: "browser_snapshot",
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
      decideClaimTestStep({
        state: "working",
        stepNumber: 5,
        normalCloseStep: 18,
        handoffCloseStep: 22,
        previousToolResult: { toolName: "get_thread", output: dataDomeOutput },
      }),
    ).toEqual({ kind: "none", nextState: "working" });
  });

  it("uses the last relevant result in the last step when AgentMail also ran", () => {
    const previous = immediatelyPrecedingToolResult([
      {
        toolResults: [
          { toolName: "browser_snapshot", output: dataDomeOutput },
          { toolName: "get_thread", output: dataDomeOutput },
        ],
      },
    ]);

    expect(previous).toEqual({ toolName: "browser_snapshot", output: dataDomeOutput });
  });

  it("does not scan an older step for a human gate", () => {
    expect(
      immediatelyPrecedingToolResult([
        { toolResults: [{ toolName: "browser_snapshot", output: dataDomeOutput }] },
        { toolResults: [{ toolName: "get_thread", output: { output: "mail" } }] },
      ]),
    ).toBeNull();
  });
});

describe("claim-test loop decisions", () => {
  function decide(
    state: ClaimTestLoopState,
    previousToolResult: { toolName: string; output: unknown } | null,
    stepNumber = 5,
  ) {
    return decideClaimTestStep({
      state,
      previousToolResult,
      stepNumber,
      normalCloseStep: 18,
      handoffCloseStep: 22,
    });
  }

  it("forces human help immediately after a browser result exposes a gate", () => {
    expect(decide("working", { toolName: "browser_snapshot", output: dataDomeOutput })).toEqual({
      kind: "request_human_help",
      nextState: "awaiting_handoff",
    });
  });

  it("forces exactly one snapshot after a resumed handoff", () => {
    const snapshot = decide("awaiting_handoff", {
      toolName: "request_human_help",
      output: { resumed: true },
    });
    expect(snapshot).toEqual({ kind: "browser_snapshot", nextState: "awaiting_snapshot" });
    expect(
      decide(snapshot.nextState, {
        toolName: "browser_snapshot",
        output: { output: '- heading "Welcome"' },
      }),
    ).toEqual({ kind: "none", nextState: "working_after_handoff" });
  });

  it("closes and then forces Inconclusive after an expired handoff", () => {
    const close = decide("awaiting_handoff", {
      toolName: "request_human_help",
      output: { resumed: false },
    });
    expect(close).toEqual({ kind: "browser_close", nextState: "closing_after_expiry" });
    expect(
      decide(close.nextState, {
        toolName: "browser_close",
        output: { success: true },
      }),
    ).toEqual({ kind: "final_inconclusive", nextState: "final" });
  });

  it("reserves enough late steps for handoff, snapshot, close, and final", () => {
    const handoff = decide("working", { toolName: "browser_snapshot", output: dataDomeOutput }, 18);
    const snapshot = decide(
      handoff.nextState,
      { toolName: "request_human_help", output: { resumed: true } },
      19,
    );
    const resumedWork = decide(
      snapshot.nextState,
      { toolName: "browser_snapshot", output: { output: '- heading "Account"' } },
      20,
    );
    const close = decide(
      resumedWork.nextState,
      { toolName: "browser_click", output: { output: '- heading "Account"' } },
      22,
    );
    const final = decide(
      close.nextState,
      { toolName: "browser_close", output: { success: true } },
      23,
    );

    expect([handoff.kind, snapshot.kind, resumedWork.kind, close.kind, final.kind]).toEqual([
      "request_human_help",
      "browser_snapshot",
      "none",
      "browser_close",
      "final",
    ]);
  });

  it("keeps the ordinary cost-neutral close at step 18", () => {
    expect(decide("working", null, 18)).toEqual({
      kind: "browser_close",
      nextState: "closing",
    });
  });

  it("arms exactly one detector-authorized human escalation", () => {
    const arm = createSingleUseHumanHandoffArm();

    expect(arm.consume()).toBe(false);
    arm.arm();
    expect(arm.consume()).toBe(true);
    expect(arm.consume()).toBe(false);
  });
});
