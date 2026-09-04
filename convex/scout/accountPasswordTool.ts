import { tool } from "ai";
import { z } from "zod";
import { browserTargetSchema } from "./browserTarget";

const accountPasswordTargetsSchema = z.object({
  passwordTarget: browserTargetSchema.describe("Visible password field"),
  passwordConfirmationTarget: browserTargetSchema
    .describe("Visible password confirmation field")
    .optional(),
});

export type AccountPasswordTargets = z.infer<typeof accountPasswordTargetsSchema>;

export function requirePasswordInputType(value: string) {
  if (value.trim().toLocaleLowerCase() !== "password") {
    throw new Error("Configured account passwords can only be filled into password inputs");
  }
}

export function createAccountPasswordFillTool(
  fill: (
    targets: AccountPasswordTargets,
    toolCallId: string,
    abortSignal?: AbortSignal,
  ) => Promise<{ filledFields: number }>,
) {
  return tool({
    description:
      "Fill the configured Scout account password without revealing it. Identify the visible password field and, when present, its confirmation field with Playwright targets. Never enter a password through browser_execute.",
    inputSchema: accountPasswordTargetsSchema,
    execute: async (targets, options) =>
      await fill(targets, options.toolCallId, options.abortSignal),
  });
}
