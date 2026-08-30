import { tool } from "ai";
import { z } from "zod";

const elementRef = z.string().regex(/^@e\d+$/, "Element ref must look like @e1");

const serviceAccountEvidenceRefsSchema = z
  .object({
    accountAccess: z.enum(["created", "recovered"]),
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
      "Record the account already bound to this run. First open an authenticated account menu that simultaneously shows the configured username or email and a Sign out or Log out control. State whether this run created the account or recovered an existing login, then supply both element refs. Trusted code reads the elements and verifies the visible identity against the bound account before recording it.",
    inputSchema: serviceAccountEvidenceRefsSchema,
    execute: async (evidence) => await record(serviceAccountEvidenceRefsSchema.parse(evidence)),
  });
}
