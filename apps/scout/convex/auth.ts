import { Password } from "@convex-dev/auth/providers/Password";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normalizeAuthEmail } from "./authEmail";
import { emailVerificationCode, passwordResetCode } from "./authEmails";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

function assertPasswordLoggingIsSafe() {
  if (process.env["AUTH_LOG_LEVEL"]?.trim().toUpperCase() === "DEBUG") {
    throw new Error("Password authentication is disabled while AUTH_LOG_LEVEL is DEBUG");
  }
}

function createPasswordProvider(
  verify: typeof emailVerificationCode,
  reset: typeof passwordResetCode,
) {
  return Password({
    verify,
    reset,
    profile(params) {
      assertPasswordLoggingIsSafe();
      const email = normalizeAuthEmail(params["email"]);
      params["email"] = email;
      return { email };
    },
  });
}

function passwordOptions(
  provider: ReturnType<typeof createPasswordProvider>,
): ConvexCredentialsUserConfig {
  // @ts-expect-error Convex Auth stores this config in `options` at runtime but omits it publicly.
  return provider.options;
}

const basePasswordProvider = createPasswordProvider(emailVerificationCode, passwordResetCode);
const basePasswordOptions = passwordOptions(basePasswordProvider);
// The generated API is from v226; this function reference stays typed until the next codegen.
const grantOnSignIn = makeFunctionReference<"mutation", { userId: Id<"users"> }, null>(
  "credits:grantOnSignIn",
);

function withEmailCooldown(
  provider: typeof emailVerificationCode,
  email: string,
  ctx: Parameters<typeof basePasswordOptions.authorize>[1],
) {
  return {
    ...provider,
    options: {
      ...provider.options,
      async generateVerificationToken() {
        await ctx.runMutation(internal.authEmailRateLimit.consume, {
          email,
          providerId: provider.options.id,
        });
        return await provider.options.generateVerificationToken();
      },
    },
  };
}

const passwordProvider = {
  ...basePasswordProvider,
  options: {
    ...basePasswordOptions,
    async authorize(
      params: Parameters<typeof basePasswordOptions.authorize>[0],
      ctx: Parameters<typeof basePasswordOptions.authorize>[1],
    ) {
      assertPasswordLoggingIsSafe();
      const email = normalizeAuthEmail(params["email"]);
      const devSeedConfig = readDevSeedPasswordAccountConfig();
      const devSeedEmail = devSeedConfig.kind === "enabled" ? devSeedConfig.email : undefined;
      if (email === devSeedEmail && params["flow"] !== "signIn") {
        throw new Error("The development seed account only allows password sign-in");
      }
      params["email"] = email;

      const flow = params["flow"];
      if (
        (flow === "email-verification" || flow === "reset-verification") &&
        params["code"] === undefined
      ) {
        throw new Error("Enter the verification code");
      }
      const requestPasswordProvider = createPasswordProvider(
        withEmailCooldown(emailVerificationCode, email, ctx),
        withEmailCooldown(passwordResetCode, email, ctx),
      );
      return await passwordOptions(requestPasswordProvider).authorize(params, ctx);
    },
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordProvider],
  callbacks: {
    beforeSessionCreation: async (ctx, { userId }) => {
      await ctx.runQuery(internal.accounts.assertActiveForAuth, { userId });
      await ctx.runMutation(grantOnSignIn, { userId });
    },
    afterUserCreatedOrUpdated: async (ctx, args) => {
      await ctx.runQuery(internal.accounts.assertActiveForAuth, { userId: args.userId });
      if (args.existingUserId === null) {
        await ctx.db.patch(args.userId, {
          isApproved: false,
          state: "active",
        });
      }
    },
  },
});
