import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { authEmailRateLimitKey, normalizeAuthEmail } from "./authEmail";
import { emailVerificationCode, passwordResetCode } from "./authEmails";
import { isAllowedAccountEmail } from "./authConfig";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

function assertPasswordLoggingIsSafe() {
  if (process.env["AUTH_LOG_LEVEL"]?.trim().toUpperCase() === "DEBUG") {
    throw new Error("Password authentication is disabled while AUTH_LOG_LEVEL is DEBUG");
  }
}

const basePasswordProvider = Password({
  verify: emailVerificationCode,
  reset: passwordResetCode,
  profile(params) {
    assertPasswordLoggingIsSafe();
    const email = normalizeAuthEmail(params["email"]);
    params["email"] = email;
    return { email };
  },
});

const basePasswordOptions = (
  basePasswordProvider as typeof basePasswordProvider & {
    options: { authorize: typeof basePasswordProvider.authorize };
  }
).options;

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
      if (!isAllowedAccountEmail(email, devSeedEmail)) {
        throw new Error("Scout is currently restricted to the administrator");
      }
      if (email === devSeedEmail && params["flow"] !== "signIn") {
        throw new Error("The development seed account only allows password sign-in");
      }
      params["email"] = email;

      if (params["flow"] === "reset") {
        await ctx.runMutation(internal.authEmailRateLimit.consume, {
          key: await authEmailRateLimitKey(passwordResetCode.id, email),
          now: Date.now(),
        });
      }
      return await basePasswordOptions.authorize(params, ctx);
    },
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordProvider],
});
