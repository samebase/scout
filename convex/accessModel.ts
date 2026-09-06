import { v } from "convex/values";
import { ACCESS_KEYS, ACCOUNT_ROLES, ACCOUNT_STATUSES } from "../shared/accessModel";
export const accountRoleValidator = v.union(...ACCOUNT_ROLES.map((role) => v.literal(role)));
export const accountStatusValidator = v.union(
  ...ACCOUNT_STATUSES.map((status) => v.literal(status)),
);
export const accessKeyValidator = v.union(...ACCESS_KEYS.map((key) => v.literal(key)));
export const accountAccessFields = v.object({
  userId: v.id("users"),
  role: accountRoleValidator,
  status: accountStatusValidator,
  isApproved: v.boolean(),
});
export const accessChangeValidator = v.union(
  v.object({ kind: v.literal("role"), role: accountRoleValidator }),
  v.object({ kind: v.literal("status"), status: accountStatusValidator }),
  v.object({ kind: v.literal("approval"), isApproved: v.boolean() }),
);
export const accessAuditFields = v.union(
  v.object({ kind: v.literal("bootstrap"), targetUserId: v.id("users"), at: v.number() }),
  v.object({
    kind: v.literal("change"),
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    before: accountAccessFields.pick("role", "status", "isApproved"),
    after: accountAccessFields.pick("role", "status", "isApproved"),
    at: v.number(),
  }),
);
export const viewerAccessValidator = v.union(
  v.object({ kind: v.literal("anonymous") }),
  v.object({ kind: v.literal("unavailable") }),
  accountAccessFields.extend({
    kind: v.literal("account"),
    accessKeys: v.array(accessKeyValidator),
  }),
);
