import { outdent } from "outdent";
import { tool } from "ai";
import { z } from "zod";

const serviceAccountEvidenceFields = {
  accountAccess: z
    .enum(["created", "recovered"])
    .describe("created for a new signup; recovered for signing in to an existing account"),
  identifier: z.string().min(1).describe("The account's saved login email or username"),
};

const serviceAccountEvidenceInputSchema = z
  .discriminatedUnion("loginMethod", [
    z
      .object({
        loginMethod: z.literal("managed_password"),
        ...serviceAccountEvidenceFields,
      })
      .strict(),
    z
      .object({
        loginMethod: z
          .literal("oauth")
          .describe("The service account was authenticated with OAuth"),
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
  ])
  .transform((input) => ({
    accountAccess: input.accountAccess,
    loginMethod:
      input.loginMethod === "managed_password"
        ? { kind: "managed_password" as const }
        : {
            kind: "oauth" as const,
            providerServiceDomain: input.oauthProviderServiceDomain,
            providerIdentifier: input.oauthProviderIdentifier,
          },
    identifier: input.identifier,
  }));

export type ServiceAccountEvidence = z.output<typeof serviceAccountEvidenceInputSchema>;

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
      - Repeated calls update the existing account.
    `,
    inputSchema: serviceAccountEvidenceInputSchema,
    execute: async (evidence, options) => await record(evidence, options.abortSignal),
  });
}
