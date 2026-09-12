import type { MutationCtx } from "../_generated/server";

export const ADMIN_EMAIL = "nicu.dev@gmail.com";

export async function insertTestAccount(ctx: Pick<MutationCtx, "db">, account: { email: string }) {
  return await ctx.db.insert("users", {
    email: account.email,
    emailVerificationTime: Date.now(),
    isApproved: true,
  });
}
