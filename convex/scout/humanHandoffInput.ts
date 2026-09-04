import { z } from "zod";

const MAX_HANDOFF_REASON_LENGTH = 500;

export const humanHandoffInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MAX_HANDOFF_REASON_LENGTH)
    .describe(
      "A plain-text description of the exact visible interaction the operator must complete in the already-open browser. Do not include a link or ask the operator to navigate elsewhere.",
    ),
});

export type HumanHandoffInput = z.output<typeof humanHandoffInputSchema>;
