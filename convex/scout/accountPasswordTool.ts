import { tool } from "ai";
import { z } from "zod";

const elementRef = z.string().regex(/^@e\d+$/, "Element ref must look like @e1");
const accountPasswordRefsSchema = z.object({
  passwordRef: elementRef.describe("Visible password field"),
  passwordConfirmationRef: elementRef.describe("Visible password confirmation field").optional(),
});

export type AccountPasswordRefs = {
  passwordRef: string;
  passwordConfirmationRef?: string | undefined;
};

export function requirePasswordInputType(value: string) {
  if (value.trim().toLocaleLowerCase() !== "password") {
    throw new Error("Configured account passwords can only be filled into password inputs");
  }
}

export function createAccountPasswordFillTool(
  fill: (refs: AccountPasswordRefs) => Promise<{ filledFields: number }>,
) {
  return tool({
    description:
      "Fill the configured Scout account password without revealing it. Supply the visible password field ref and, when present, its confirmation field ref. Never enter a password through browser_fill or browser_type.",
    inputSchema: accountPasswordRefsSchema,
    execute: async (refs) => await fill(accountPasswordRefsSchema.parse(refs)),
  });
}
