import { ConvexError } from "convex/values";
import { z } from "zod";

export const INSUFFICIENT_CREDITS_MESSAGE =
  "You need more credits to continue. Check your balance in Settings.";

const creditFailureSchema = z.object({
  code: z.enum(["INSUFFICIENT_CREDITS", "CREDIT_HOLD"]),
  message: z.string(),
});

type CreditFailureCode = z.infer<typeof creditFailureSchema>["code"];

export function creditFailureMessage(code: CreditFailureCode) {
  switch (code) {
    case "INSUFFICIENT_CREDITS":
      return INSUFFICIENT_CREDITS_MESSAGE;
    case "CREDIT_HOLD":
      return "Your credits need review. Contact an admin with this conversation’s link.";
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

export function creditFailure(error: unknown) {
  if (!(error instanceof ConvexError)) return null;
  const result = creditFailureSchema.safeParse(error.data);
  return result.success ? result.data : null;
}
