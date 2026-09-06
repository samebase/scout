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

export const list = query({
  access: "access_members_manage",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    accountAccessFields.extend({ email: v.union(v.string(), v.null()), verified: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate(args.paginationOpts);
    const page = result.page.map((user) => ({
      userId: user._id,
      role: readViewerRoleForUser(user),
      isApproved: user.isApproved ?? false,
      email: user.email ?? null,
      verified: user.emailVerificationTime !== undefined,
    }));
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
    await ctx.db.patch(user._id, { isApproved: args.isApproved });
    return null;
  },
});
