import { describe, expect, test } from "vite-plus/test";
import type { Id } from "../../convex/_generated/dataModel";
import { countGenerationSteps, formatRunMetadata, toolOutputFailure } from "./scout-run-message";

describe("Scout transcript metadata", () => {
  test("shows the model cost estimate alongside the recorded token usage", () => {
    expect(
      formatRunMetadata(
        {
          model: "qwen/qwen3.7-flash",
          scout: {
            id: "scout" as Id<"scouts">,
            displayName: "Conrad Scout",
          },
          usage: {
            promptTokens: 100_000,
            completionTokens: 2_000,
            costUsd: 0.00326,
          },
        },
        23,
      ),
    ).toBe("Conrad Scout, Qwen 3.7 Flash, 23 steps, 100,000 input, 2,000 output, ~$0.00326 model");
  });

  test("counts generation-step boundaries in the message parts", () => {
    expect(
      countGenerationSteps([
        { type: "text", text: "Starting" },
        { type: "step-start" },
        { type: "tool-browser_execute", toolCallId: "tool-1", state: "output-available" },
        { type: "step-start" },
      ]),
    ).toBe(2);
  });
});

describe("Scout tool results", () => {
  test("keeps finalized AI SDK tool-input failures classified as errors", () => {
    const failure =
      "AI_InvalidToolInputError: Invalid input for tool fill_account_password: expected object, received string";

    expect(toolOutputFailure(failure)).toBe(failure);
  });

  test("classifies unsuccessful structured tool output as an error", () => {
    const failure = { success: false, error: "Playwright execution timed out" };

    expect(toolOutputFailure(failure)).toBe(failure);
  });

  test("does not classify successful output with a null error field as an error", () => {
    expect(toolOutputFailure({ success: true, error: null, output: "done" })).toBeUndefined();
    expect(toolOutputFailure("ordinary tool output")).toBeUndefined();
  });
});
