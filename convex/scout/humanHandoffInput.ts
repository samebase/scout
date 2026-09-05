import { z } from "zod";

const MAX_HANDOFF_REASON_LENGTH = 500;

export const humanHandoffInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MAX_HANDOFF_REASON_LENGTH)
    .describe(
      "In at most 500 characters, describe the user's requested takeover or the visible human-only check in the open browser. Do not include private links or credentials.",
    ),
});

export type HumanHandoffInput = z.output<typeof humanHandoffInputSchema>;
