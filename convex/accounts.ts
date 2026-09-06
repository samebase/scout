import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { mutation, publicQuery, query } from "./functions";
import { resolveViewer } from "./access";
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

export async function initializeAccountAccess(ctx: MutationCtx, userId: Id<"users">) {
  if (!(await ctx.db.get(userId))) throw new ConvexError("Account not found");
  const existing = await ctx.db
    .query("accountAccess")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("accountAccess", {
    userId,
    role: "role_member",
    status: "active",
    isApproved: false,
  });
}
export const initialize = internalMutation({
  args: { userId: v.id("users") },
  returns: v.id("accountAccess"),
  handler: (ctx, args) => initializeAccountAccess(ctx, args.userId),
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
    const accessId = await initializeAccountAccess(ctx, args.userId);
    const access = await ctx.db.get(accessId);
    if (!access || access.status !== "active")
      throw new ConvexError("An active account is required");
    await ctx.db.patch(accessId, { role: "role_admin", isApproved: true });
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
      .query("accountAccess")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (access) => {
        const user = await ctx.db.get(access.userId);
        if (!user) throw new ConvexError("Account reference is invalid");
        return {
          userId: access.userId,
          role: access.role,
          status: access.status,
          isApproved: access.isApproved,
          email: user.email ?? null,
          verified: user.emailVerificationTime !== undefined,
        };
      }),
    );
    return { ...result, page };
  },
});

export const changeAccess = mutation({
  access: "access_members_manage",
  args: { userId: v.id("users"), change: accessChangeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const previous = await ctx.db
      .query("accountAccess")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .unique();
    if (!user || !previous) throw new ConvexError("Account not found");
    const before = {
      role: previous.role,
      status: previous.status,
      isApproved: previous.isApproved,
    };
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
        .query("accountAccess")
        .withIndex("by_role_status_and_approval", (q) =>
          q.eq("role", "role_admin").eq("status", "active").eq("isApproved", true),
        )) {
        if (candidate.userId === args.userId) continue;
        const other = await ctx.db.get(candidate.userId);
        if (other?.emailVerificationTime !== undefined) {
          anotherAdmin = true;
          break;
        }
      }
      if (!anotherAdmin) throw new ConvexError("Keep at least one active approved admin");
    }
    await ctx.db.patch(previous._id, after);
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
