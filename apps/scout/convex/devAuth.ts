import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  createEmailPasswordAccount,
  hasEmailPasswordAccount,
  readUserByEmail,
  setNewPassword,
} from "./auth";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

/**
Creates or updates the development and preview password account from the `DEV_SEED_AUTH_*` values:
an approved users row with a verified email, its email-password account, and the password.
`signInWithEmailPassword` accepts this address without a sign-up link.
*/
export const seedPasswordAccount = internalMutation({
  args: {},
  returns: v.object({ created: v.boolean(), email: v.string() }),
  handler: async (ctx) => {
    const config = readDevSeedPasswordAccountConfig();
    if (config.kind === "disabled") {
      throw new Error("Development password account seeding is disabled");
    }

    const now = Date.now();
    const existing = await readUserByEmail(ctx, config.email);
    if (existing?.state === "deleting") throw new Error("The seed account is being deleted");
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        state: "active",
        email: config.email,
        emailVerificationTime: now,
        isApproved: true,
      }));
    if (existing) {
      await ctx.db.patch(userId, {
        isApproved: true,
        emailVerificationTime: existing.emailVerificationTime ?? now,
      });
    }

    await setNewPassword(ctx, userId, config.password);
    if (!(await hasEmailPasswordAccount(ctx, userId)))
      await createEmailPasswordAccount(ctx, userId);
    return { created: existing === null, email: config.email };
  },
});
