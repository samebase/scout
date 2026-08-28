import { v } from "convex/values";

export const scoutWebsiteIdentityValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
});
