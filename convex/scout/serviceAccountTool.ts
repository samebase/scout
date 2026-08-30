import { tool } from "ai";
import { z } from "zod";

const MAX_IDENTIFIER_LENGTH = 320;
const elementRef = z.string().regex(/^@e\d+$/, "Element ref must look like @e1");

export type ServiceAccountEvidenceRefs = {
  identifier: string;
  accountAccess: "created" | "recovered";
  identityRef: string;
  sessionControlRef: string;
};

export function createServiceAccountRecordingTool(
  record: (
    evidence: ServiceAccountEvidenceRefs,
  ) => Promise<{ serviceAccountId: string; created: boolean }>,
) {
  return tool({
    description:
      "Record the tested product account for this Scout. First open an authenticated account menu that simultaneously shows the exact username or email and a Sign out or Log out control. State whether this run created the account or recovered an existing login, then supply the identifier and both element refs; the tool reads those elements itself before recording the account.",
    inputSchema: z.object({
      identifier: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
      accountAccess: z.enum(["created", "recovered"]),
      identityRef: elementRef.describe("Element whose visible text contains the exact identifier"),
      sessionControlRef: elementRef.describe(
        "Visible Sign out, Log out, Logout, or Sign off control in the same authenticated UI",
      ),
    }),
    execute: async (evidence) => await record(evidence),
  });
}
