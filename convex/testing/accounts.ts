import type { AccountRole } from "../../shared/accessModel";
import type { MutationCtx } from "../_generated/server";

export const ADMIN_EMAIL = "nicu.dev@gmail.com";

export async function insertTestAccount(
  ctx: Pick<MutationCtx, "db">,
  account: { email: string; role: AccountRole },
) {
  const userId = await ctx.db.insert("users", {
    email: account.email,
    emailVerificationTime: Date.now(),
  });
  await ctx.db.insert("accountAccess", {
    userId,
    role: account.role,
    status: "active",
    isApproved: true,
  });
  return userId;
}
