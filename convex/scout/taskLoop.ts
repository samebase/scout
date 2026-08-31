type ToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

type StepWithToolResults = {
  readonly toolResults: readonly ToolResult[];
  readonly content?: readonly {
    readonly type: string;
    readonly toolName?: string;
  }[];
};

type ToolError = { readonly toolName: string };

export type TaskLoopState =
  | "working"
  | "awaiting_handoff"
  | "awaiting_snapshot"
  | "closing"
  | "closing_after_expiry"
  | "closing_after_failure"
  | "resolving"
  | "final";

export type TaskLoopDecision =
  | { kind: "none"; nextState: "working" }
  | { kind: "request_human_help"; nextState: "awaiting_handoff" }
  | { kind: "browser_snapshot"; nextState: "awaiting_snapshot" }
  | {
      kind: "browser_close";
      nextState: "closing" | "closing_after_expiry" | "closing_after_failure";
    }
  | { kind: "resolve_attempt"; nextState: "resolving" }
  | { kind: "resolution_failed"; nextState: "final" }
  | {
      kind: "final";
      nextState: "final";
      humanHelpOutcome: "none" | "expired" | "failed";
    };

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

export function createSingleUseAttemptResolutionArm() {
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
      (result.toolName.startsWith("browser_") ||
        result.toolName === "request_human_help" ||
        result.toolName === "resolve_attempt")
    ) {
      return result;
    }
  }
  return null;
}

export function immediatelyPrecedingToolError(
  steps: readonly StepWithToolResults[],
): ToolError | null {
  const content = steps.at(-1)?.content ?? [];
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (part?.type === "tool-error" && part.toolName) {
      return { toolName: part.toolName };
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
  if (output["status"] === "failed") return "failed" as const;
  if (output["resumed"] === false || output["status"] === "expired") {
    return "expired" as const;
  }
  return null;
}

function decisionAfterHandoff(result: ToolResult | null): TaskLoopDecision | null {
  if (result?.toolName !== "request_human_help") return null;
  const outcome = humanHandoffOutcome(result.output);
  if (outcome === "resumed") {
    return { kind: "browser_snapshot", nextState: "awaiting_snapshot" };
  }
  if (outcome === "expired") {
    return { kind: "browser_close", nextState: "closing_after_expiry" };
  }
  if (outcome === "failed") {
    return { kind: "browser_close", nextState: "closing_after_failure" };
  }
  return null;
}

function decisionAfterBrowserClose(result: ToolResult | null): TaskLoopDecision | null {
  if (result?.toolName !== "browser_close") return null;
  if (!isRecord(result.output) || result.output["success"] !== true) {
    return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
  }
  return { kind: "resolve_attempt", nextState: "resolving" };
}

export function decideTaskStep(args: {
  state: TaskLoopState;
  stepNumber: number;
  normalCloseStep: number;
  previousToolResult: ToolResult | null;
  previousToolError?: ToolError | null;
}): TaskLoopDecision {
  switch (args.state) {
    case "final":
      return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
    case "closing":
      return (
        decisionAfterBrowserClose(args.previousToolResult) ?? {
          kind: "final",
          nextState: "final",
          humanHelpOutcome: "none",
        }
      );
    case "closing_after_expiry":
      return { kind: "final", nextState: "final", humanHelpOutcome: "expired" };
    case "closing_after_failure":
      return { kind: "final", nextState: "final", humanHelpOutcome: "failed" };
    case "resolving":
      if (
        args.previousToolError?.toolName === "resolve_attempt" ||
        args.previousToolResult?.toolName !== "resolve_attempt"
      ) {
        return { kind: "resolution_failed", nextState: "final" };
      }
      return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
    case "awaiting_handoff": {
      const afterHandoff = decisionAfterHandoff(args.previousToolResult);
      if (afterHandoff) return afterHandoff;
      return { kind: "browser_close", nextState: "closing_after_expiry" };
    }
    case "awaiting_snapshot":
      if (
        args.previousToolResult?.toolName !== "browser_snapshot" ||
        !isRecord(args.previousToolResult.output) ||
        args.previousToolResult.output["success"] !== true
      ) {
        return { kind: "browser_close", nextState: "closing_after_failure" };
      }
      return { kind: "browser_close", nextState: "closing" };
    case "working": {
      const afterHandoff = decisionAfterHandoff(args.previousToolResult);
      if (afterHandoff) return afterHandoff;
      if (args.previousToolResult?.toolName === "browser_close") {
        return (
          decisionAfterBrowserClose(args.previousToolResult) ?? {
            kind: "final",
            nextState: "final",
            humanHelpOutcome: "none",
          }
        );
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
