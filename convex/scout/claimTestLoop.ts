type ToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

type StepWithToolResults = {
  readonly toolResults: readonly ToolResult[];
};

export type ClaimTestLoopState =
  | "working"
  | "working_after_handoff"
  | "awaiting_handoff"
  | "awaiting_snapshot"
  | "closing"
  | "closing_after_expiry"
  | "final";

export type ClaimTestLoopDecision =
  | { kind: "none"; nextState: "working" | "working_after_handoff" }
  | { kind: "request_human_help"; nextState: "awaiting_handoff" }
  | { kind: "browser_snapshot"; nextState: "awaiting_snapshot" }
  | { kind: "browser_close"; nextState: "closing" | "closing_after_expiry" }
  | { kind: "final"; nextState: "final" }
  | { kind: "final_inconclusive"; nextState: "final" };

export function createSingleUseHumanHandoffArm() {
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    consume: () => {
      if (!armed) return false;
      armed = false;
      return true;
    },
  };
}

export function immediatelyPrecedingToolResult(
  steps: readonly StepWithToolResults[],
): ToolResult | null {
  const results = steps.at(-1)?.toolResults ?? [];
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (
      result &&
      (result.toolName.startsWith("browser_") || result.toolName === "request_human_help")
    ) {
      return result;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultText(value: unknown) {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return [value["output"], value["error"]]
    .filter((field): field is string => typeof field === "string")
    .join("\n");
}

export function detectsHumanGate(output: unknown) {
  const text = resultText(output);
  return (
    /\b(?:h|re)?captcha\b/i.test(text) ||
    /\bdatadome\b/i.test(text) ||
    /\bverify(?:[ -]+that)?[ -]+you(?:'re|[ -]+are)?[ -]+(?:a[ -]+)?human\b/i.test(text) ||
    /\bhuman[ -]verification\b/i.test(text) ||
    /\bdevice[ -]verification\b/i.test(text)
  );
}

export function humanHandoffOutcome(output: unknown) {
  if (!isRecord(output)) return null;
  if (output["resumed"] === true) return "resumed" as const;
  if (output["resumed"] === false || output["status"] === "expired") {
    return "expired" as const;
  }
  return null;
}

function decisionAfterHandoff(result: ToolResult | null): ClaimTestLoopDecision | null {
  if (result?.toolName !== "request_human_help") return null;
  const outcome = humanHandoffOutcome(result.output);
  if (outcome === "resumed") {
    return { kind: "browser_snapshot", nextState: "awaiting_snapshot" };
  }
  if (outcome === "expired") {
    return { kind: "browser_close", nextState: "closing_after_expiry" };
  }
  return null;
}

export function decideClaimTestStep(args: {
  state: ClaimTestLoopState;
  stepNumber: number;
  normalCloseStep: number;
  handoffCloseStep: number;
  previousToolResult: ToolResult | null;
}): ClaimTestLoopDecision {
  switch (args.state) {
    case "final":
      return { kind: "final", nextState: "final" };
    case "closing":
      return { kind: "final", nextState: "final" };
    case "closing_after_expiry":
      return { kind: "final_inconclusive", nextState: "final" };
    case "awaiting_handoff": {
      const afterHandoff = decisionAfterHandoff(args.previousToolResult);
      if (afterHandoff) return afterHandoff;
      return { kind: "browser_close", nextState: "closing_after_expiry" };
    }
    case "awaiting_snapshot":
      return args.stepNumber >= args.handoffCloseStep
        ? { kind: "browser_close", nextState: "closing" }
        : { kind: "none", nextState: "working_after_handoff" };
    case "working_after_handoff":
      if (args.previousToolResult?.toolName === "browser_close") {
        return { kind: "final", nextState: "final" };
      }
      return args.stepNumber >= args.handoffCloseStep
        ? { kind: "browser_close", nextState: "closing" }
        : { kind: "none", nextState: "working_after_handoff" };
    case "working": {
      const afterHandoff = decisionAfterHandoff(args.previousToolResult);
      if (afterHandoff) return afterHandoff;
      if (args.previousToolResult?.toolName === "browser_close") {
        return { kind: "final", nextState: "final" };
      }
      if (
        args.previousToolResult?.toolName.startsWith("browser_") &&
        detectsHumanGate(args.previousToolResult.output)
      ) {
        return { kind: "request_human_help", nextState: "awaiting_handoff" };
      }
      return args.stepNumber >= args.normalCloseStep
        ? { kind: "browser_close", nextState: "closing" }
        : { kind: "none", nextState: "working" };
    }
  }
}
