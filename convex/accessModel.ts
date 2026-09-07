import { v } from "convex/values";
import { ACCESS_KEYS, VIEWER_ROLES } from "../shared/accessModel";
export const viewerRoleValidator = v.union(...VIEWER_ROLES.map((role) => v.literal(role)));
export const accessKeyValidator = v.union(...ACCESS_KEYS.map((key) => v.literal(key)));
export const accountAccessFields = v.object({
  userId: v.id("users"),
  role: viewerRoleValidator,
  isApproved: v.boolean(),
});
export const viewerAccessValidator = v.union(
  v.object({ kind: v.literal("anonymous") }),
  v.object({ kind: v.literal("unavailable") }),
  v.object({ kind: v.literal("deleting") }),
  v.object({ kind: v.literal("deleted") }),
  accountAccessFields.extend({
    kind: v.literal("account"),
    accessKeys: v.array(accessKeyValidator),
  }),
);
