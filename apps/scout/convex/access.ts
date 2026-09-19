import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, type Infer } from "convex/values";
import {
  readAccessKeysForRole,
  canAccess,
  type AccountAccessKey,
  type ViewerRole,
} from "../shared/accessModel";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { viewerAccessValidator } from "./accessModel";
import { CURRENT_TERMS_VERSION, TERMS_ACCEPTANCE_REQUIRED } from "../shared/terms";

export type ViewerAccess = Infer<typeof viewerAccessValidator>;

const ADMIN_EMAILS = new Set(["nicu.dev@gmail.com", "nicu@samebase.com"]);

export function readViewerRoleForUser(
  user: Exclude<Doc<"users">, { state: "deleted" }>,
): ViewerRole {
  if (user.email && ADMIN_EMAILS.has(user.email.toLowerCase())) return "role_staff";
  return user.isApproved ? "role_member" : "role_pending_access";
}

export async function readUserAccess(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<ViewerAccess> {
  const user = await ctx.db.get(userId);
  if (!user) return { kind: "unavailable" };
  if (user.state === "deleted") return { kind: "deleted" };
  if (user.state === "deleting") return { kind: "deleting" };
  if (user.emailVerificationTime === undefined) return { kind: "unavailable" };
  if (user.acceptedTermsVersion !== CURRENT_TERMS_VERSION)
    return { kind: "terms_required", userId };
  const role = readViewerRoleForUser(user);
  return {
    kind: "account",
    userId,
    email: user.email ?? null,
    role,
    isApproved: user.isApproved ?? false,
    accessKeys: [...readAccessKeysForRole(role)],
  };
}
export async function resolveViewer(ctx: Pick<QueryCtx, "auth" | "db">): Promise<ViewerAccess> {
  const userId = await getAuthUserId(ctx);
  return userId ? await readUserAccess(ctx, userId) : { kind: "anonymous" };
}
export function requireViewerPermission(viewer: ViewerAccess, access: AccountAccessKey) {
  if (viewer.kind === "terms_required") throw new ConvexError(TERMS_ACCEPTANCE_REQUIRED);
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
