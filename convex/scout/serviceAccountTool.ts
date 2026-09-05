import { tool } from "ai";
import { z } from "zod";

const serviceAccountEvidenceFields = {
  accountAccess: z.enum(["created", "recovered"]),
  identityText: z
    .string()
    .min(1)
    .describe("Exact visible registered login identifier on the authenticated service page"),
  sessionControlText: z
    .string()
    .min(1)
    .describe("Exact visible text of the Sign out, Log out, Logout, or Sign off control"),
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
    identityText: input.identityText,
    sessionControlText: input.sessionControlText,
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
      "Record an authenticated account in this Scout's service-account inventory immediately after successful account creation or login recovery, before continuing other work. The page must show the saved login identifier and a Sign out or Log out control. If the account menu shows a different display name or username, open account settings to find the registered email. State whether the account was created or an existing login was recovered, and whether it used the managed password or OAuth through another exact Scout account. For OAuth, include that provider account's exact service domain and identifier. Trusted code re-reads the current URL and both visible text values. It updates an exact existing match or records a new OAuth account where the visible identity belongs to this Scout. Managed-password accounts must already be registered.",
    inputSchema: serviceAccountEvidenceInputSchema,
    execute: async (evidence, options) => await record(evidence, options.abortSignal),
  });
}
