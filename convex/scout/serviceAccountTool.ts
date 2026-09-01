import { tool } from "ai";
import { z } from "zod";

const elementRef = z.string().regex(/^@e\d+$/, "Element ref must look like @e1");

const observedLoginMethodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("managed_password") }).strict(),
  z
    .object({
      kind: z.literal("oauth"),
      providerServiceDomain: z
        .string()
        .describe("Exact product domain of the account used for OAuth, such as github.com"),
      providerIdentifier: z
        .string()
        .describe("Exact username or email of the account used for OAuth"),
    })
    .strict(),
]);

const serviceAccountEvidenceRefsSchema = z
  .object({
    accountAccess: z.enum(["created", "recovered"]),
    loginMethod: observedLoginMethodSchema.describe(
      "How this service account was authenticated during the current task",
    ),
    identityRef: elementRef.describe(
      "Element whose visible text contains the bound account's exact identifier",
    ),
    sessionControlRef: elementRef.describe(
      "Visible Sign out, Log out, Logout, or Sign off control in the same authenticated UI",
    ),
  })
  .strict();

export type ServiceAccountEvidenceRefs = z.infer<typeof serviceAccountEvidenceRefsSchema>;

export function createServiceAccountRecordingTool(
  record: (
    evidence: ServiceAccountEvidenceRefs,
  ) => Promise<{ serviceAccountId: string; created: boolean }>,
) {
  return tool({
    description:
      "Record an authenticated account in this Scout's service-account inventory before closing the browser. First open an account menu that simultaneously shows one of the Scout's known usernames or email addresses and a Sign out or Log out control; a team or workspace name is not an account identity. State whether this attempt created the account or recovered an existing login and whether it used the managed password or OAuth through another exact Scout account. Then supply both element refs. Trusted code reads the current URL and visible elements. It updates an exact existing match, or creates the missing inventory record when the observed service is this Task's product.",
    inputSchema: serviceAccountEvidenceRefsSchema,
    execute: async (evidence) => await record(serviceAccountEvidenceRefsSchema.parse(evidence)),
  });
}
