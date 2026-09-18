import { ConvexError } from "convex/values";
import { z } from "zod";

export const INSUFFICIENT_CREDITS_MESSAGE = "Not enough credits to start this operation.";

const creditFailureSchema = z.object({
  code: z.enum(["INSUFFICIENT_CREDITS", "CREDIT_HOLD"]),
  message: z.string(),
});

export function creditFailure(error: unknown) {
  if (!(error instanceof ConvexError)) return null;
  const result = creditFailureSchema.safeParse(error.data);
  return result.success ? result.data : null;
}
