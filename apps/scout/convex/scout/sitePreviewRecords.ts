import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { siteHostnameSchema } from "../../shared/site";
import { internalMutation, internalQuery } from "../_generated/server";
import { resolveViewer } from "../access";
import { accessibleSite } from "./siteListings";
import { previewPublicationArgs, sitePreviewFinished } from "./sitePreviewModel";
import { updatePreviewPublication } from "./sitePreviewPublication";
import type { Doc } from "../_generated/dataModel";

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
    await updatePreviewPublication(
      ctx,
      { ...site, preview: args.preview },
      site.latestPublicTask !== null,
    );
    return null;
  },
});

export const retryPublication = internalMutation({
  args: { site: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { site: hostname }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
      .unique();
    if (site?.preview?.kind !== "ready") return false;
    await updatePreviewPublication(ctx, site, site.latestPublicTask !== null, true);
    return true;
  },
});

function currentPublication(site: Doc<"sites"> | null, args: typeof previewPublicationArgs.type) {
  if (
    site?.latestPublicTask !== null &&
    site?.preview?.kind === "ready" &&
    site.preview.key === args.sourceKey &&
    site.preview.publication?.kind === "publishing" &&
    site.preview.publication.version === args.version
  )
    return site.preview;
  return null;
}

export const publicationCurrent = internalQuery({
  args: previewPublicationArgs.fields,
  returns: v.boolean(),
  handler: async (ctx, args) => currentPublication(await ctx.db.get(args.siteId), args) !== null,
});

export const finishPublication = internalMutation({
  args: previewPublicationArgs.extend({
    result: v.union(
      v.object({ kind: v.literal("public") }),
      v.object({ kind: v.literal("failed"), message: v.string() }),
    ),
  }).fields,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    const preview = currentPublication(site, args);
    if (!preview) return false;
    await ctx.db.patch(args.siteId, {
      preview: { ...preview, publication: { ...args.result, version: args.version } },
    });
    return true;
  },
});

export const publishExisting = internalMutation({
  args: { paginationOpts: paginationOptsValidator, retryFailed: v.boolean() },
  returns: v.object({ continueCursor: v.string(), isDone: v.boolean(), processed: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("sites").withIndex("by_hostname").paginate(args.paginationOpts);
    for (const site of page.page)
      await updatePreviewPublication(ctx, site, site.latestPublicTask !== null, args.retryFailed);
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      processed: page.page.length,
    };
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
