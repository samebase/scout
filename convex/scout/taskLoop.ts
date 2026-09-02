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

export type TaskLoopState = "working" | "resolving" | "final";

export type TaskLoopDecision =
  | { kind: "none"; nextState: "working" }
  | { kind: "request_human_help"; nextState: "final" }
  | { kind: "resolve_attempt"; nextState: "resolving" }
  | { kind: "resolution_failed"; nextState: "final" }
  | {
      kind: "final";
      nextState: "final";
      humanHelpOutcome: "none" | "waiting";
    };

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
    /\bhuman[ -]+checkpoint\b/i.test(text) ||
    /\bhuman[ -]verification\b/i.test(text) ||
    /\bdevice[ -]verification\b/i.test(text)
  );
}

function decisionAfterHandoff(result: ToolResult | null): TaskLoopDecision | null {
  if (result?.toolName !== "request_human_help") return null;
  return { kind: "final", nextState: "final", humanHelpOutcome: "waiting" };
}

export function decideTaskStep(args: {
  state: TaskLoopState;
  previousToolResult: ToolResult | null;
  previousToolError?: ToolError | null;
}): TaskLoopDecision {
  switch (args.state) {
    case "final":
      return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
    case "resolving":
      if (
        args.previousToolError?.toolName === "resolve_attempt" ||
        args.previousToolResult?.toolName !== "resolve_attempt"
      ) {
        return { kind: "resolution_failed", nextState: "final" };
      }
      return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
    case "working": {
      const afterHandoff = decisionAfterHandoff(args.previousToolResult);
      if (afterHandoff) return afterHandoff;
      if (args.previousToolResult?.toolName === "resolve_attempt") {
        return { kind: "final", nextState: "final", humanHelpOutcome: "none" };
      }
      if (
        args.previousToolResult?.toolName.startsWith("browser_") &&
        detectsHumanGate(args.previousToolResult.output)
      ) {
        return { kind: "request_human_help", nextState: "final" };
      }
      if (args.previousToolError?.toolName === "browser_open") {
        return { kind: "resolve_attempt", nextState: "resolving" };
      }
      return { kind: "none", nextState: "working" };
    }
  }
}
