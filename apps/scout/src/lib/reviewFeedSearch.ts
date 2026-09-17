import { z } from "zod";
import { siteSearchSchema } from "../../shared/site";

export const reviewFeedSearch = z.object({
  site: siteSearchSchema.transform((value) => value || undefined).optional(),
  scope: z.enum(["public", "mine"]).optional(),
});

export type ReviewFeedSearch = z.infer<typeof reviewFeedSearch>;
