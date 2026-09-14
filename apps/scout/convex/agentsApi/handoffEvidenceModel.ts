import { v, type Infer } from "convex/values";

export const handoffEvidenceValidator = v.object({
  capturedAt: v.number(),
  pages: v.array(
    v.object({
      tabId: v.string(),
      url: v.string(),
      title: v.string(),
      content: v.string(),
    }),
  ),
});

export type HandoffEvidence = Infer<typeof handoffEvidenceValidator>;
