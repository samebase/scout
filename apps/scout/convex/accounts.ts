import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { mutation, publicMutation, publicQuery, query } from "./functions";
import { readViewerRoleForUser, resolveViewer } from "./access";
import { accountAccessFields, viewerAccessValidator } from "./accessModel";
import { taskPreferences as taskPreferencesValidator } from "./schema";
import { omitNullish } from "../shared/omitNullish";
import { sessionRecordingConsent } from "./sessionRecordingModel";
import { SESSION_RECORDING_CONSENT_VERSION } from "../shared/sessionRecording";

export const analyticsPreferences = publicQuery({
  access: "access_public",
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      recording: v.union(v.null(), sessionRecordingConsent),
    }),
  ),
  handler: async (ctx) => {
    if (ctx.viewer.kind !== "account" && ctx.viewer.kind !== "terms_required") return null;
    const user = await ctx.db.get(ctx.viewer.userId);
    if (!user || user.state === "deleting" || user.state === "deleted") return null;
    return { userId: user._id, recording: user.sessionRecordingConsent ?? null };
  },
});

export const setSessionRecording = publicMutation({
  access: "access_public",
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    if (ctx.viewer.kind !== "account" && ctx.viewer.kind !== "terms_required") {
      throw new ConvexError("Not authorized");
    }
    const user = await ctx.db.get(ctx.viewer.userId);
    if (!user || user.state === "deleting" || user.state === "deleted")
      throw new ConvexError("Account not found");
    const now = Date.now();
    await ctx.db.patch(ctx.viewer.userId, {
      sessionRecordingConsent: {
        enabled,
        version: SESSION_RECORDING_CONSENT_VERSION,
        updatedAt: now,
        source: "settings" as const,
        ...omitNullish({
          lastGrant: enabled
            ? {
                version: SESSION_RECORDING_CONSENT_VERSION,
                grantedAt: now,
                source: "settings" as const,
              }
            : user.sessionRecordingConsent?.lastGrant,
        }),
      },
    });
    return null;
  },
});

export const acceptTerms = publicMutation({
  access: "access_public",
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (ctx.viewer.kind === "account") return null;
    if (ctx.viewer.kind !== "terms_required") throw new ConvexError("Not authorized");
    await ctx.db.patch(ctx.viewer.userId, { termsAcceptedAt: Date.now() });
    return null;
  },
});

export const taskPreferences = query({
  access: "access_account",
  args: {},
  returns: taskPreferencesValidator,
  handler: async (ctx) => {
    const user = await ctx.db.get(ctx.viewer.userId);
    if (!user || user.state === "deleted") throw new ConvexError("Account not found");
    return omitNullish({ lastTaskEngine: user.lastTaskEngine, lastScoutId: user.lastScoutId });
  },
});

export const setTaskPreferences = mutation({
  access: "access_account",
  args: taskPreferencesValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.lastScoutId !== undefined) {
      const scout = await ctx.db.get(args.lastScoutId);
      if (!scout || scout.status !== "active") throw new ConvexError("Scout is not available");
    }
    await ctx.db.patch(ctx.viewer.userId, omitNullish(args));
    return null;
  },
});

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
