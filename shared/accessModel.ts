export const ACCOUNT_ROLES = ["role_member", "role_admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export const ACCOUNT_STATUSES = ["active", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const ACCESS_KEYS = [
  "access_public",
  "access_account",
  "access_play",
  "access_review",
  "access_lab",
  "access_scout_manage",
  "access_members_manage",
] as const;
export type AccessKey = (typeof ACCESS_KEYS)[number];
export type AccountAccessKey = Exclude<AccessKey, "access_public">;
export const ROLE_ACCESS_GRANTS: Record<AccountRole, readonly AccessKey[]> = {
  role_member: ["access_public", "access_account", "access_play", "access_review"],
  role_admin: [
    "access_public",
    "access_account",
    "access_play",
    "access_review",
    "access_lab",
    "access_scout_manage",
    "access_members_manage",
  ],
};
export function accountPermissions(
  role: AccountRole,
  status: AccountStatus,
  isApproved: boolean,
): readonly AccessKey[] {
  switch (status) {
    case "active":
      return isApproved ? ROLE_ACCESS_GRANTS[role] : ["access_public", "access_account"];
    case "suspended":
      return ["access_public", "access_account"];
    default:
      status satisfies never;
      throw new Error("Invalid account status");
  }
}
export function canAccess(permission: AccessKey, permissions: readonly AccessKey[]) {
  return permissions.includes(permission);
}
