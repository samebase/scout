import { v } from "convex/values";
import { siteHostnameSchema } from "../../shared/site";
import { internalMutation, internalQuery } from "../_generated/server";
import { resolveViewer } from "../access";
import { accessibleSite } from "./siteListings";
import { sitePreviewFinished } from "./sitePreviewModel";

export const claim = internalMutation({
  args: { site: v.string(), retryFailed: v.boolean() },
  returns: v.union(v.id("sites"), v.null()),
  handler: async (ctx, args) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.site))
      .unique();
    if (!site) throw new Error("Site not found");
    if (site.preview && !(args.retryFailed && site.preview.kind === "failed")) return null;
    await ctx.db.patch(site._id, { preview: { kind: "capturing", startedAt: Date.now() } });
    return site._id;
  },
});

export const finish = internalMutation({
  args: { siteId: v.id("sites"), preview: sitePreviewFinished },
  returns: v.null(),
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.preview?.kind !== "capturing") throw new Error("Site capture is not active");
    await ctx.db.patch(site._id, { preview: args.preview });
    return null;
  },
});

export const imageKey = internalQuery({
  args: { site: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const site = await accessibleSite(
      ctx,
      siteHostnameSchema.parse(args.site),
      await resolveViewer(ctx),
    );
    return site?.preview?.kind === "ready" ? site.preview.key : null;
  },
});
