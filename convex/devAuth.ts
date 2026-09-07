import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { normalizeAuthEmail } from "./authEmail";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

export const approveSeedPasswordAccount = internalMutation({
  args: {
    email: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = normalizeAuthEmail(args.email);
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (query) =>
        query.eq("provider", "password").eq("providerAccountId", email),
      )
      .take(2);

    if (accounts.length > 1) {
      throw new Error(`Multiple password accounts exist for ${email}`);
    }
    const account = accounts[0];
    if (!account) return false;
    const user = await ctx.db.get(account.userId);
    if (
      !user ||
      user.state === "deleted" ||
      user.state === "deleting" ||
      user.emailVerificationTime === undefined
    )
      throw new Error("A verified seed account is required");
    await ctx.db.patch(user._id, { isApproved: true });
    return true;
  },
});

const seedPasswordAccountResult = v.object({
  created: v.boolean(),
  email: v.string(),
});
type SeedPasswordAccountResult = Infer<typeof seedPasswordAccountResult>;

export const seedPasswordAccount = internalAction({
  args: {},
  returns: seedPasswordAccountResult,
  handler: async (ctx): Promise<SeedPasswordAccountResult> => {
    const config = readDevSeedPasswordAccountConfig();
    if (config.kind === "disabled") {
      throw new Error("Development password account seeding is disabled");
    }

    const exists: boolean = await ctx.runMutation(internal.devAuth.approveSeedPasswordAccount, {
      email: config.email,
    });
    if (exists) {
      // @ts-expect-error Convex Auth 0.0.94 does not accept exact optional fields under TypeScript 6.
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: {
          id: config.email,
          secret: config.password,
        },
      });
      return { created: false, email: config.email };
    }

    const verifiedProfile = {
      email: config.email,
      emailVerified: true,
    };
    // @ts-expect-error Convex Auth 0.0.94 does not accept exact optional fields under TypeScript 6.
    await createAccount(ctx, {
      provider: "password",
      account: {
        id: config.email,
        secret: config.password,
      },
      profile: verifiedProfile,
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });
    await ctx.runMutation(internal.devAuth.approveSeedPasswordAccount, { email: config.email });

    return { created: true, email: config.email };
  },
});
