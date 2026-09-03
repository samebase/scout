import { tool } from "ai";
import { z } from "zod";

const serviceAccountEvidenceInputSchema = z
  .object({
    accountAccess: z.enum(["created", "recovered"]),
    loginMethod: z
      .enum(["managed_password", "oauth"])
      .describe("How this service account was authenticated in the current browser session"),
    oauthProviderServiceDomain: z
      .string()
      .optional()
      .describe("For OAuth only, the service domain of the provider account, such as github.com"),
    oauthProviderIdentifier: z
      .string()
      .optional()
      .describe("For OAuth only, the exact username or email of the provider account"),
    identityText: z
      .string()
      .min(1)
      .describe("Exact visible Scout username or email on the authenticated service page"),
    sessionControlText: z
      .string()
      .min(1)
      .describe("Exact visible text of the Sign out, Log out, Logout, or Sign off control"),
  })
  .strict();

export type ServiceAccountEvidence = {
  accountAccess: "created" | "recovered";
  loginMethod:
    | { kind: "managed_password" }
    | { kind: "oauth"; providerServiceDomain: string; providerIdentifier: string };
  identityText: string;
  sessionControlText: string;
};

function serviceAccountEvidence(
  input: z.infer<typeof serviceAccountEvidenceInputSchema>,
): ServiceAccountEvidence {
  if (input.loginMethod === "managed_password") {
    return {
      accountAccess: input.accountAccess,
      loginMethod: { kind: "managed_password" },
      identityText: input.identityText,
      sessionControlText: input.sessionControlText,
    };
  }
  if (!input.oauthProviderServiceDomain || !input.oauthProviderIdentifier) {
    throw new Error("OAuth account recording requires the provider domain and identifier");
  }
  return {
    accountAccess: input.accountAccess,
    loginMethod: {
      kind: "oauth",
      providerServiceDomain: input.oauthProviderServiceDomain,
      providerIdentifier: input.oauthProviderIdentifier,
    },
    identityText: input.identityText,
    sessionControlText: input.sessionControlText,
  };
}

export function createServiceAccountRecordingTool(
  record: (
    evidence: ServiceAccountEvidence,
  ) => Promise<{ serviceAccountId: string; created: boolean }>,
) {
  return tool({
    description:
      "Record an authenticated account in this Scout's service-account inventory before closing the browser. First open an account menu that simultaneously shows one of the Scout's exact known usernames or email addresses and a Sign out or Log out control; a team or workspace name is not an account identity. State whether the account was created or an existing login was recovered, and whether it used the managed password or OAuth through another exact Scout account. For OAuth, include that provider account's exact service domain and identifier. Trusted code re-reads the current URL and both visible text values. It updates an exact existing match or records a new OAuth account where the visible identity belongs to this Scout. Managed-password accounts must already be registered.",
    inputSchema: serviceAccountEvidenceInputSchema,
    execute: async (input) =>
      await record(serviceAccountEvidence(serviceAccountEvidenceInputSchema.parse(input))),
  });
}
