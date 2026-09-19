import { ConvexError, v } from "convex/values";
import { CURRENT_TERMS_VERSION } from "../shared/terms";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { publicMutation } from "./functions";

async function recordAcceptance(ctx: MutationCtx, userId: Id<"users">) {
  const existing = await ctx.db
    .query("termsAcceptances")
    .withIndex("by_user_id_and_version", (q) =>
      q.eq("userId", userId).eq("version", CURRENT_TERMS_VERSION),
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("termsAcceptances", {
      userId,
      version: CURRENT_TERMS_VERSION,
      acceptedAt: Date.now(),
    });
  }
  await ctx.db.patch(userId, { acceptedTermsVersion: CURRENT_TERMS_VERSION });
  return null;
}

export const recordForSignup = internalMutation({
  args: { userId: v.id("users"), version: v.literal(CURRENT_TERMS_VERSION) },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.state === "deleted" || user.state === "deleting")
      throw new ConvexError("Account not available");
    return await recordAcceptance(ctx, userId);
  },
});

export const accept = publicMutation({
  access: "access_public",
  args: { version: v.string() },
  returns: v.null(),
  handler: async (ctx, { version }) => {
    if (ctx.viewer.kind !== "account" && ctx.viewer.kind !== "terms_required")
      throw new ConvexError("Not authorized");
    if (version !== CURRENT_TERMS_VERSION)
      throw new ConvexError(
        "The terms have changed. Reload the page and review them before continuing.",
      );
    return await recordAcceptance(ctx, ctx.viewer.userId);
  },
});
