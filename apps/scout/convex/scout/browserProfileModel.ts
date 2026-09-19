import { v } from "convex/values";

export const browserProfileSummary = v.object({
  cookieCount: v.number(),
  cookieDomainCount: v.number(),
  checkedAt: v.number(),
});
