export const VIEWER_ROLES = ["role_pending_access", "role_member", "role_staff"] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];
export const ACCESS_KEYS = [
  "access_public",
  "access_account",
  "access_play",
  "access_review",
  "access_scout_view",
  "access_lab",
  "access_scout_manage",
  "access_members_manage",
] as const;
export type AccessKey = (typeof ACCESS_KEYS)[number];
export type AccountAccessKey = Exclude<AccessKey, "access_public">;
export const ROLE_ACCESS_GRANTS: Record<ViewerRole, readonly AccessKey[]> = {
  role_pending_access: ["access_public", "access_account"],
  role_member: [
    "access_public",
    "access_account",
    "access_play",
    "access_review",
    "access_scout_view",
  ],
  role_staff: ACCESS_KEYS,
};
export function readAccessKeysForRole(role: ViewerRole): readonly AccessKey[] {
  return ROLE_ACCESS_GRANTS[role];
}
export function canAccess(permission: AccessKey, permissions: readonly AccessKey[]) {
  return permissions.includes(permission);
}
