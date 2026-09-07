import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { authEmailRateLimitKey } from "./authEmail";
import {
  AUTH_EMAIL_COOLDOWN,
  EMAIL_VERIFICATION_PROVIDER_ID,
  PASSWORD_RESET_PROVIDER_ID,
} from "../shared/auth";

const EMAIL_COOLDOWN_MS = 60_000;

export const consume = internalMutation({
  args: {
    email: v.string(),
    providerId: v.union(
      v.literal(EMAIL_VERIFICATION_PROVIDER_ID),
      v.literal(PASSWORD_RESET_PROVIDER_ID),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.email),
      )
      .unique();
    const user = account && (await ctx.db.get(account.userId));
    if (!user || user.state === "deleting" || user.state === "deleted")
      throw new ConvexError("Account unavailable");
    const key = await authEmailRateLimitKey(args.providerId, args.email);
    const now = Date.now();
    const existing = await ctx.db
      .query("authEmailRateLimits")
      .withIndex("by_key", (query) => query.eq("key", key))
      .unique();

    if (existing && now - existing.lastSentAt < EMAIL_COOLDOWN_MS) {
      throw new ConvexError(AUTH_EMAIL_COOLDOWN);
    }

    if (existing) {
      await ctx.db.patch(existing._id, { lastSentAt: now });
    } else {
      await ctx.db.insert("authEmailRateLimits", {
        key,
        lastSentAt: now,
      });
    }
    return null;
  },
});
