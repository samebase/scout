import { tool } from "ai";
import { z } from "zod";

const serviceAccountEvidenceFields = {
  accountAccess: z.enum(["created", "recovered"]),
  identifier: z
    .string()
    .min(1)
    .describe(
      "The account's saved login email or username, even when the page masks it or displays a different name",
    ),
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
    description:
      "Record successful account creation or login recovery immediately after observing success, then continue the task. Use the saved login identifier from this Scout's account inventory or the signup you just completed. A different display name, masked email, or missing logout button does not prevent recording; do not navigate elsewhere just to find those elements. This records your observed outcome, not an independent authentication check. Trusted code checks the current service URL, binds the account to this Scout, and saves a reference to the latest browser observation. Managed-password accounts must already be prepared or registered. For OAuth, include the provider account's exact service domain and identifier from this Scout's inventory. If recording fails, resolve the reported account or session mismatch; do not repeat an unchanged call.",
    inputSchema: serviceAccountEvidenceInputSchema,
    execute: async (evidence, options) => await record(evidence, options.abortSignal),
  });
}
