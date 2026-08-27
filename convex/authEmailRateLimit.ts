import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const RESET_EMAIL_COOLDOWN_MS = 60_000;

export const consume = internalMutation({
  args: {
    key: v.string(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authEmailRateLimits")
      .withIndex("by_key", (query) => query.eq("key", args.key))
      .unique();

    if (existing && args.now - existing.lastSentAt < RESET_EMAIL_COOLDOWN_MS) {
      throw new Error("Wait before requesting another password reset code");
    }

    if (existing) {
      await ctx.db.patch(existing._id, { lastSentAt: args.now });
    } else {
      await ctx.db.insert("authEmailRateLimits", {
        key: args.key,
        lastSentAt: args.now,
      });
    }
    return null;
  },
});
