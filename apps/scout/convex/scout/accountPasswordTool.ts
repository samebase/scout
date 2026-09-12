import { outdent } from "outdent";
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

const accountPasswordPreparationSchema = z
  .object({
    serviceName: z.string().trim().min(1).max(100).describe("Name of the service being joined"),
    serviceDomain: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .describe(
        "The service's domain, containing the current signup host, such as example.com for accounts.example.com",
      ),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .describe("The new account's username or this Scout's own email address"),
  })
  .strict();

export function createAccountPasswordPreparationTool(
  prepare: (
    account: z.infer<typeof accountPasswordPreparationSchema>,
    abortSignal?: AbortSignal,
  ) => Promise<{ serviceAccountId: string; credentialHost: string }>,
) {
  return tool({
    description: outdent`
      Prepare a managed password for a new account on the current HTTPS signup page.

      - Trusted code generates and encrypts the password for this Scout and the page's
        exact host; the password is never returned.
      - Repeating the same preparation reuses the saved password and never resets it.
      - Use fill_account_password to enter it.
      - Use an existing account's saved login method when one is available.

      Preparation does not create the account on the service: finish signup and
      immediately call record_authenticated_service_account after authentication succeeds.
    `,
    inputSchema: accountPasswordPreparationSchema,
    execute: async (account, options) => ({
      status: "prepared" as const,
      ...(await prepare(account, options.abortSignal)),
    }),
  });
}

export function createAccountPasswordFillTool(
  fill: (
    targets: AccountPasswordTargets,
    toolCallId: string,
    abortSignal?: AbortSignal,
  ) => Promise<{ filledFields: number }>,
) {
  return tool({
    description: outdent`
      Fill the configured Scout account password without revealing it.

      - Identify the visible password field and, when present, its confirmation field by
        role, label, or text, or use a CSS selector from the inspected page DOM.
      - Each CSS target must identify one visible field.
      - The tool verifies the saved login host and password input type.
      - Never enter a password through browser_execute.
    `,
    inputSchema: accountPasswordTargetsSchema,
    execute: async (targets, options) =>
      await fill(targets, options.toolCallId, options.abortSignal),
  });
}
