import { outdent } from "outdent";
import { tool } from "ai";
import type { Infer } from "convex/values";
import { z } from "zod";
import type { observedLoginMethodValidator } from "./model";

const serviceAccountEvidenceFields = {
  accountAccess: z
    .enum(["created", "recovered"])
    .describe("created for a new signup; recovered for signing in to an existing account"),
  identifier: z.string().min(1).describe("The account's saved login email or username"),
  verification: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe(
      "What you checked to establish that this Scout is signed in: an account menu/settings page identifying the Scout, or an action requiring sign-in whose saved result you verified. Never include passwords, codes or tokens.",
    ),
};

const serviceAccountEvidenceInputSchema = z.discriminatedUnion("loginMethod", [
  z
    .object({
      loginMethod: z.literal("managed_password"),
      ...serviceAccountEvidenceFields,
    })
    .strict(),
  z
    .object({
      loginMethod: z
        .literal("passwordless")
        .describe("Sign-in by an email code or magic link; no saved password or OAuth provider"),
      ...serviceAccountEvidenceFields,
    })
    .strict(),
  z
    .object({
      loginMethod: z.literal("oauth").describe("The service account was authenticated with OAuth"),
      ...serviceAccountEvidenceFields,
      oauthProviderServiceDomain: z
        .string()
        .min(1)
        .describe("The provider account service domain, such as github.com"),
      oauthProviderIdentifier: z
        .string()
        .min(1)
        .describe("The exact username or email of the provider account"),
    })
    .strict(),
]);

export type ServiceAccountEvidence = Pick<
  z.output<typeof serviceAccountEvidenceInputSchema>,
  "accountAccess" | "identifier" | "verification"
> & { loginMethod: Infer<typeof observedLoginMethodValidator> };

export function createServiceAccountRecordingTool(
  record: (
    evidence: ServiceAccountEvidence,
    abortSignal?: AbortSignal,
  ) => Promise<{ serviceAccountId: string; created: boolean }>,
) {
  return tool({
    description: outdent`
      Record an observed successful signup or sign-in for future tasks.

      - Use when an account is new or its successful authentication has not been recorded.
      - The current browser session determines the service.
      - Managed-password accounts must already be prepared or registered; OAuth requires
        a provider account in this Scout's inventory.
      - Use passwordless for email-code or magic-link sign-in. Do not prepare a password
        or invent an OAuth provider for these accounts.
      - Before recording, verify the Scout's identity in account settings or its account
        menu, or perform an action requiring sign-in and verify the saved result.
        Describe that check in verification. A landing page, product tour, welcome screen,
        prepared password, or submitted signup form alone does not prove authentication.
      - Finish outstanding signup, CAPTCHA, and email verification steps first. If login
        cannot be verified, do not record it. Continue investigating or report the blocker.
      - Repeated calls update the existing account.
    `,
    inputSchema: serviceAccountEvidenceInputSchema,
    // Convex Agent persists validated inputs and validates them again before execution.
    // Keep the tool input flat until this mapping to the account model.
    execute: async (input, options) =>
      await record(
        {
          accountAccess: input.accountAccess,
          loginMethod:
            input.loginMethod !== "oauth"
              ? { kind: input.loginMethod }
              : {
                  kind: "oauth",
                  providerServiceDomain: input.oauthProviderServiceDomain,
                  providerIdentifier: input.oauthProviderIdentifier,
                },
          identifier: input.identifier,
          verification: input.verification,
        },
        options.abortSignal,
      ),
  });
}
