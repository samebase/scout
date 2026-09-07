import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { mutation, publicQuery, query } from "./functions";
import { readViewerRoleForUser, resolveViewer } from "./access";
import { accountAccessFields, viewerAccessValidator } from "./accessModel";

export const currentViewerAccess = publicQuery({
  access: "access_public",
  args: {},
  returns: viewerAccessValidator,
  handler: (ctx) => ctx.viewer,
});
export const viewerForAction = internalQuery({
  args: {},
  returns: viewerAccessValidator,
  handler: resolveViewer,
});

export const assertActiveForAuth = internalQuery({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.state === "deleting" || user.state === "deleted")
      throw new ConvexError("This account is being deleted or has been deleted");
    return null;
  },
});

export const list = query({
  access: "access_members_manage",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.union(
      accountAccessFields.extend({
        kind: v.literal("active"),
        email: v.union(v.string(), v.null()),
        verified: v.boolean(),
      }),
      v.object({
        kind: v.literal("deleting"),
        userId: v.id("users"),
        email: v.union(v.string(), v.null()),
      }),
      v.object({ kind: v.literal("deleted"), userId: v.id("users") }),
    ),
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate(args.paginationOpts);
    const page = result.page.map((user) => {
      if (user.state === "deleted") return { kind: "deleted" as const, userId: user._id };
      if (user.state === "deleting")
        return { kind: "deleting" as const, userId: user._id, email: user.email ?? null };
      return {
        kind: "active" as const,
        userId: user._id,
        role: readViewerRoleForUser(user),
        isApproved: user.isApproved ?? false,
        email: user.email ?? null,
        verified: user.emailVerificationTime !== undefined,
      };
    });
    return { ...result, page };
  },
});

export const setApproval = mutation({
  access: "access_members_manage",
  args: { userId: v.id("users"), isApproved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("Account not found");
    if (user.state === "deleting" || user.state === "deleted")
      throw new ConvexError("This account is being deleted or has been deleted");
    await ctx.db.patch(user._id, { isApproved: args.isApproved });
    return null;
  },
});
