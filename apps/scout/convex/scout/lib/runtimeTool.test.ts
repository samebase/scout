import { tool, TypeValidationError } from "ai";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { walkthroughDraftSchema } from "../../tasks/walkthroughReport";
import { diagnosticMessage } from "./redaction";
import { requireRuntimeTool } from "./runtimeTool";

const options = { toolCallId: "runtime-tool-1", messages: [], context: {} };

describe("runtime tool validation", () => {
  test("reports the offending walkthrough field without echoing the input", async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const runtimeTool = requireRuntimeTool(
      { save_walkthrough: tool({ inputSchema: walkthroughDraftSchema, execute }) },
      "save_walkthrough",
    );
    const secret = "sk_test_runtime_payload_canary_123456789";
    const input = {
      summary: `${secret} ${"Observed page content. ".repeat(60)}`,
      checks: [{ label: "Save", result: "passed", explanation: "x".repeat(402) }],
      sections: [
        { heading: "Saved", explanation: "The result persisted.", captureIds: ["shot-1"] },
      ],
    };

    const error: unknown = await runtimeTool
      .execute(input, options)
      .catch((error: unknown) => error);
    const issues = [
      {
        origin: "string",
        code: "too_big",
        maximum: 400,
        inclusive: true,
        path: ["checks", 0, "explanation"],
        message: "Too big: expected string to have <=400 characters",
      },
    ];

    expect(error).toBeInstanceOf(z.ZodError);
    expect(error).toMatchObject({ issues, message: JSON.stringify(issues, null, 2) });
    const message = diagnosticMessage(error);
    expect(message).toBe(JSON.stringify(issues, null, 2));
    expect(message).not.toContain(secret);
    expect(message).not.toContain(input.summary);
    expect(message).not.toContain(input.checks[0].explanation);
    expect(execute).not.toHaveBeenCalled();
  });

  test("forwards the parsed value and execution options", async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const runtimeTool = requireRuntimeTool(
      { save_walkthrough: tool({ inputSchema: walkthroughDraftSchema, execute }) },
      "save_walkthrough",
    );
    const input = {
      summary: "  Saved the project.  ",
      checks: [{ label: "  Save  ", result: "passed", explanation: `  ${"x".repeat(400)}  ` }],
      sections: [
        { heading: "  Saved  ", explanation: "  The result persisted.  ", captureIds: ["shot-1"] },
      ],
    };

    await expect(runtimeTool.execute(input, options)).resolves.toEqual({ saved: true });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      {
        summary: "Saved the project.",
        checks: [{ label: "Save", result: "passed", explanation: "x".repeat(400) }],
        sections: [
          { heading: "Saved", explanation: "The result persisted.", captureIds: ["shot-1"] },
        ],
      },
      options,
    );
  });

  test("preserves errors thrown by tool execution", async () => {
    const error = new TypeValidationError({ value: "result", cause: new z.ZodError([]) });
    const execute = vi.fn(async (): Promise<void> => {
      throw error;
    });
    const runtimeTool = requireRuntimeTool(
      { example: tool({ inputSchema: z.object({}), execute }) },
      "example",
    );

    await expect(runtimeTool.execute({}, options)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledExactlyOnceWith({}, options);
  });
});
