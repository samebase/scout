import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { mutation, publicQuery, query } from "./functions";
import { accountState, resolveViewer } from "./access";
import { accessChangeValidator, accountAccessFields, viewerAccessValidator } from "./accessModel";
import { accountPermissions, canAccess } from "../shared/accessModel";

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

export const bootstrapAdmin = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const bootstrap = await ctx.db
      .query("accountAccessAudit")
      .withIndex("by_kind", (q) => q.eq("kind", "bootstrap"))
      .unique();
    if (bootstrap) {
      if (bootstrap.targetUserId !== args.userId)
        throw new ConvexError("Administrator bootstrap is already complete");
      return null;
    }
    const user = await ctx.db.get(args.userId);
    if (!user || user.emailVerificationTime === undefined)
      throw new ConvexError("A verified account is required");
    if (accountState(user).status !== "active")
      throw new ConvexError("An active account is required");
    await ctx.db.patch(user._id, { role: "role_admin", status: "active", isApproved: true });
    await ctx.db.insert("accountAccessAudit", {
      kind: "bootstrap",
      targetUserId: args.userId,
      at: Date.now(),
    });
    return null;
  },
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
      ...accountState(user),
      email: user.email ?? null,
      verified: user.emailVerificationTime !== undefined,
    }));
    return { ...result, page };
  },
});

export const changeAccess = mutation({
  access: "access_members_manage",
  args: { userId: v.id("users"), change: accessChangeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("Account not found");
    const before = accountState(user);
    const after = { ...before };
    switch (args.change.kind) {
      case "role":
        after.role = args.change.role;
        break;
      case "status":
        after.status = args.change.status;
        break;
      case "approval":
        after.isApproved = args.change.isApproved;
        break;
      default:
        args.change satisfies never;
    }
    if (
      before.role === after.role &&
      before.status === after.status &&
      before.isApproved === after.isApproved
    )
      return null;
    if (!before.isApproved && after.isApproved && user.emailVerificationTime === undefined)
      throw new ConvexError("Verify the account before approving it");
    if (before.role !== "role_admin" && after.role === "role_admin") {
      if (user.emailVerificationTime === undefined)
        throw new ConvexError("Verify the account before making it an admin");
      if (!after.isApproved) throw new ConvexError("Approve the account before making it an admin");
    }
    if (
      before.role === "role_admin" &&
      before.status === "active" &&
      before.isApproved &&
      (after.role !== "role_admin" || after.status !== "active" || !after.isApproved)
    ) {
      let anotherAdmin = false;
      for await (const candidate of ctx.db
        .query("users")
        .withIndex("by_role_and_approval", (q) =>
          q.eq("role", "role_admin").eq("isApproved", true),
        )) {
        if (candidate._id === args.userId) continue;
        if (candidate.status !== "suspended" && candidate.emailVerificationTime !== undefined) {
          anotherAdmin = true;
          break;
        }
      }
      if (!anotherAdmin) throw new ConvexError("Keep at least one active approved admin");
    }
    await ctx.db.patch(user._id, after);
    await ctx.db.insert("accountAccessAudit", {
      kind: "change",
      actorUserId: ctx.viewer.userId,
      targetUserId: args.userId,
      before,
      after,
      at: Date.now(),
    });
    if (
      canAccess("access_lab", accountPermissions(before.role, before.status, before.isApproved)) &&
      !canAccess("access_lab", accountPermissions(after.role, after.status, after.isApproved))
    ) {
      await ctx.scheduler.runAfter(0, internal.accountRevocation.cleanupChats, {
        userId: args.userId,
        cursor: null,
      });
    }
    return null;
  },
});
