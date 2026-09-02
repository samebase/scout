// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import { afterEach } from "vite-plus/test";
import type { Id } from "../../convex/_generated/dataModel";
import {
  ScoutRunMessageView,
  countGenerationSteps,
  formatRunMetadata,
  repairedToolInputFields,
  toolOutputFailure,
} from "./scout-run-message";

afterEach(() => cleanup());

describe("Scout transcript metadata", () => {
  test("keeps the stored failure visible after generation finishes", () => {
    render(
      ScoutRunMessageView({
        message: {
          id: "message-1",
          _creationTime: 1,
          key: "message-1",
          order: 1,
          stepOrder: 0,
          status: "failed",
          role: "assistant",
          parts: [],
          text: "",
          metadata: {
            model: "qwen/qwen3.7-flash",
            scout: {
              id: "scout" as Id<"scouts">,
              displayName: "Conrad Scout",
            },
            failure: "Tool input did not match its schema",
          },
        },
      }),
    );

    const failure = screen.getByRole("status");
    expect(failure.textContent).toBe("Generation failed: Tool input did not match its schema");
    expect(failure.className).toContain("text-destructive");
  });

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
  test("reports fields repaired from stringified JSON tool arguments", () => {
    expect(
      repairedToolInputFields({
        callProviderMetadata: {
          scout: {
            inputRepair: {
              method: "json-parse",
              fields: ["limit", "ascending"],
            },
          },
        },
      }),
    ).toEqual(["limit", "ascending"]);
  });

  test("does not mark native tool arguments as repaired", () => {
    expect(repairedToolInputFields({ callProviderMetadata: { qwen: {} } })).toEqual([]);
  });

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
