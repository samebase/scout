import { z } from "zod";
import { siteHostnameSchema } from "../../shared/site";

export const reviewFeedSearch = z.object({
  site: siteHostnameSchema.optional(),
  scope: z.enum(["public", "mine"]).optional(),
});

export type ReviewFeedSearch = z.infer<typeof reviewFeedSearch>;
