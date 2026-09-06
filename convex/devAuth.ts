import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { normalizeAuthEmail } from "./authEmail";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

const seedPasswordAccountUserResolution = v.union(
  v.object({
    kind: v.literal("existing"),
    userId: v.id("users"),
  }),
  v.object({
    kind: v.literal("missing"),
  }),
);
type SeedPasswordAccountUserResolution = Infer<typeof seedPasswordAccountUserResolution>;

export const resolveSeedPasswordAccountUser = internalMutation({
  args: {
    email: v.string(),
  },
  returns: seedPasswordAccountUserResolution,
  handler: async (ctx, args): Promise<SeedPasswordAccountUserResolution> => {
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
    return account ? { kind: "existing", userId: account.userId } : { kind: "missing" };
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

    const resolution: SeedPasswordAccountUserResolution = await ctx.runMutation(
      internal.devAuth.resolveSeedPasswordAccountUser,
      { email: config.email },
    );
    if (resolution.kind === "existing") {
      // @ts-expect-error Convex Auth 0.0.94 does not accept exact optional fields under TypeScript 6.
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: {
          id: config.email,
          secret: config.password,
        },
      });
      await ctx.runMutation(internal.accounts.initialize, { userId: resolution.userId });
      await ctx.runMutation(internal.accounts.bootstrapAdmin, { userId: resolution.userId });
      return { created: false, email: config.email };
    }

    const verifiedProfile = {
      email: config.email,
      emailVerified: true,
    };
    // @ts-expect-error Convex Auth 0.0.94 does not accept exact optional fields under TypeScript 6.
    const created = await createAccount(ctx, {
      provider: "password",
      account: {
        id: config.email,
        secret: config.password,
      },
      profile: verifiedProfile,
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });
    await ctx.runMutation(internal.accounts.bootstrapAdmin, { userId: created.user._id });

    return { created: true, email: config.email };
  },
});
