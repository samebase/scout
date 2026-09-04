// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import { afterEach } from "vite-plus/test";
import type { Id } from "../../convex/_generated/dataModel";
import { ScoutRunMessageView, formatRunMetadata } from "./scout-run-message";
import {
  countGenerationSteps,
  parseScoutMessageParts,
  repairedToolInputFields,
  toolInputPreview,
  toolOutputFailure,
} from "#lib/scout-message-parts";

afterEach(() => cleanup());

// @ts-expect-error This isolated view fixture does not cross the Convex ID boundary.
const scoutId: Id<"scouts"> = "scout";
// @ts-expect-error This isolated view fixture does not cross the Convex ID boundary.
const turnId: Id<"scoutTurns"> = "turn";

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
            turnId,
            model: "qwen/qwen3.7-flash",
            scout: {
              id: scoutId,
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
    expect(screen.getByTitle("Message ID: message-1").textContent).toBe("#message-1");
  });

  test("shows the model cost estimate alongside the recorded token usage", () => {
    expect(
      formatRunMetadata(
        {
          turnId,
          model: "qwen/qwen3.7-flash",
          scout: {
            id: scoutId,
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
      countGenerationSteps(
        parseScoutMessageParts([
          { type: "text", text: "Starting" },
          { type: "step-start" },
          {
            type: "tool-browser_execute",
            toolCallId: "tool-1",
            state: "output-available",
          },
          { type: "step-start" },
        ]),
      ),
    ).toBe(2);
  });
});

describe("Scout tool results", () => {
  test("parses one AI SDK tool part before the renderer reads it", () => {
    expect(
      parseScoutMessageParts([
        {
          type: "tool-browser_execute",
          toolCallId: "tool-1",
          state: "output-available",
          input: { code: "return await page.title()" },
          output: { success: true, output: "Example" },
          callProviderMetadata: {
            scout: {
              inputRepair: { method: "json-parse", fields: ["code"] },
            },
          },
        },
      ]),
    ).toEqual([
      {
        kind: "tool",
        tool: {
          name: "browser_execute",
          state: "output-available",
          toolCallId: "tool-1",
          input: '{\n  "code": "return await page.title()"\n}',
          inputPreview: "return await page.title()",
          output: '{\n  "success": true,\n  "output": "Example"\n}',
          error: undefined,
          repairedInputFields: ["code"],
        },
      },
    ]);
  });

  test("shows a short reference for a tool call while retaining its full ID", () => {
    render(
      ScoutRunMessageView({
        message: {
          id: "message-with-tool",
          _creationTime: 1,
          key: "message-with-tool",
          order: 1,
          stepOrder: 0,
          status: "success",
          role: "assistant",
          parts: [
            {
              type: "tool-browser_execute",
              toolCallId: "tool-call-1234567890",
              state: "output-error",
              input: { code: "await page.click('button')" },
              errorText: "locator timed out",
            },
          ],
          text: "",
        },
      }),
    );

    const reference = screen.getByTitle("Tool call ID: tool-call-1234567890");
    expect(reference.textContent).toBe("#34567890");
    expect(reference.getAttribute("data-reference-id")).toBe("tool-call-1234567890");
  });

  test("previews Playwright code without the browser_execute input wrapper", () => {
    const code = "await page.getByRole('button', { name: 'Continue' }).click();";

    expect(toolInputPreview("browser_execute", { code })).toBe(code);
  });

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

    expect(toolOutputFailure(failure)).toBe(JSON.stringify(failure, null, 2));
  });

  test("does not classify successful output with a null error field as an error", () => {
    expect(toolOutputFailure({ success: true, error: null, output: "done" })).toBeUndefined();
    expect(toolOutputFailure("ordinary tool output")).toBeUndefined();
  });
});
