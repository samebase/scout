import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, type Infer } from "convex/values";
import { accountPermissions, canAccess, type AccountAccessKey } from "../shared/accessModel";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { viewerAccessValidator } from "./accessModel";

export type ViewerAccess = Infer<typeof viewerAccessValidator>;

export async function readUserAccess(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<ViewerAccess> {
  const user = await ctx.db.get(userId);
  if (!user || user.emailVerificationTime === undefined) return { kind: "unavailable" };
  const access = await ctx.db
    .query("accountAccess")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
  if (!access) return { kind: "unavailable" };
  return {
    kind: "account",
    userId,
    role: access.role,
    status: access.status,
    isApproved: access.isApproved,
    accessKeys: [...accountPermissions(access.role, access.status, access.isApproved)],
  };
}
export async function resolveViewer(ctx: Pick<QueryCtx, "auth" | "db">): Promise<ViewerAccess> {
  const userId = await getAuthUserId(ctx);
  return userId ? await readUserAccess(ctx, userId) : { kind: "anonymous" };
}
export function requireViewerPermission(viewer: ViewerAccess, access: AccountAccessKey) {
  if (viewer.kind !== "account" || !canAccess(access, viewer.accessKeys))
    throw new ConvexError("Not authorized");
  return viewer;
}
export async function requirePermission(
  ctx: Pick<QueryCtx, "auth" | "db">,
  access: AccountAccessKey,
) {
  return requireViewerPermission(await resolveViewer(ctx), access);
}
export async function requireUserPermission(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  access: AccountAccessKey,
) {
  return requireViewerPermission(await readUserAccess(ctx, userId), access);
}
