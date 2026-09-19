import type { MutationCtx } from "../_generated/server";
import { CURRENT_TERMS_VERSION } from "../../shared/terms";

export const ADMIN_EMAIL = "nicu.dev@gmail.com";

export async function insertTestAccount(ctx: Pick<MutationCtx, "db">, account: { email: string }) {
  const userId = await ctx.db.insert("users", {
    email: account.email,
    emailVerificationTime: Date.now(),
    isApproved: true,
    acceptedTermsVersion: CURRENT_TERMS_VERSION,
  });
  await ctx.db.insert("termsAcceptances", {
    userId,
    version: CURRENT_TERMS_VERSION,
    acceptedAt: Date.now(),
  });
  return userId;
}
