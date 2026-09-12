import { z } from "zod";

const MAX_HANDOFF_REASON_LENGTH = 500;

export const humanHandoffInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MAX_HANDOFF_REASON_LENGTH)
    .describe(
      "Briefly describe what the user needs to do in the browser. Do not include private links or credentials.",
    ),
});

export type HumanHandoffInput = z.output<typeof humanHandoffInputSchema>;
