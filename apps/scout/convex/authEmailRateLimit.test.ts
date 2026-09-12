import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  AUTH_EMAIL_COOLDOWN,
  EMAIL_VERIFICATION_PROVIDER_ID,
  PASSWORD_RESET_PROVIDER_ID,
} from "../shared/auth";

const modules = import.meta.glob("./**/*.*s");

test("email cooldowns work before auth provider initialization and keep reset available", async () => {
  const backend = convexTest(schema, modules);
  const email = "pending@example.test";
  await backend.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
    });
  });
  await backend.mutation(internal.authEmailRateLimit.consume, {
    email,
    providerId: EMAIL_VERIFICATION_PROVIDER_ID,
  });
  await expect(
    backend.mutation(internal.authEmailRateLimit.consume, {
      email,
      providerId: EMAIL_VERIFICATION_PROVIDER_ID,
    }),
  ).rejects.toThrow(AUTH_EMAIL_COOLDOWN);
  await expect(
    backend.mutation(internal.authEmailRateLimit.consume, {
      email,
      providerId: PASSWORD_RESET_PROVIDER_ID,
    }),
  ).resolves.toBeNull();
  await expect(
    backend.mutation(internal.authEmailRateLimit.consume, {
      email,
      providerId: PASSWORD_RESET_PROVIDER_ID,
    }),
  ).rejects.toThrow(AUTH_EMAIL_COOLDOWN);
});
