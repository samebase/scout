import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { siteHostnameSchema } from "../../shared/site";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { requireViewerPermission } from "../access";
import { publicQuery } from "../functions";
import { accessibleSite, ensureSite, syncChatSite } from "./siteListings";
import { previewMetadata, sitePreviewMetadata } from "./sitePreviewModel";

const siteRow = v.object({
  hostname: v.string(),
  preview: v.union(sitePreviewMetadata, v.null()),
});

function presentSite(site: Doc<"sites">) {
  return { hostname: site.hostname, preview: previewMetadata(site.preview) };
}

export const list = publicQuery({
  access: "access_public",
  args: {
    scope: v.union(v.literal("public"), v.literal("mine"), v.literal("all")),
    site: v.union(v.string(), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(siteRow),
  handler: async (ctx, args) => {
    const hostname = args.site === null ? null : siteHostnameSchema.parse(args.site);
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, 24),
      maximumRowsRead: Math.min(args.paginationOpts.maximumRowsRead ?? 24, 24),
      maximumBytesRead: Math.min(args.paginationOpts.maximumBytesRead ?? 256 * 1024, 256 * 1024),
    };
    if (args.scope === "all") {
      requireViewerPermission(ctx.viewer, "access_lab");
      const rows =
        hostname === null
          ? ctx.db.query("sites").withIndex("by_hostname")
          : ctx.db.query("sites").withIndex("by_hostname", (q) => q.eq("hostname", hostname));
      const page = await rows.order("asc").paginate(paginationOpts);
      return { ...page, page: page.page.map(presentSite) };
    }
    if (args.scope === "mine") {
      const { userId } = requireViewerPermission(ctx.viewer, "access_account");
      const rows =
        hostname === null
          ? ctx.db
              .query("siteUserListings")
              .withIndex("by_user_id_and_latest_task_created_at_and_hostname", (q) =>
                q.eq("userId", userId),
              )
          : ctx.db
              .query("siteUserListings")
              .withIndex("by_user_id_and_hostname", (q) =>
                q.eq("userId", userId).eq("hostname", hostname),
              );
      const page = await rows.order("desc").paginate(paginationOpts);
      return {
        ...page,
        page: await Promise.all(
          page.page.map(async ({ hostname }) => {
            const site = await ctx.db
              .query("sites")
              .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
              .unique();
            if (!site) throw new Error("Site listing has no site");
            return presentSite(site);
          }),
        ),
      };
    }
    const rows =
      hostname === null
        ? ctx.db
            .query("sites")
            .withIndex("by_latest_public_task_created_at_and_hostname", (q) =>
              q.gt("latestPublicTask.createdAt", undefined),
            )
        : ctx.db
            .query("sites")
            .withIndex("by_hostname_and_latest_public_task_created_at", (q) =>
              q.eq("hostname", hostname).gt("latestPublicTask.createdAt", undefined),
            );
    const page = await rows.order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.map(presentSite) };
  },
});

export const get = publicQuery({
  access: "access_public",
  args: { site: v.string() },
  returns: v.union(siteRow, v.null()),
  handler: async (ctx, { site }) => {
    const hostname = siteHostnameSchema.parse(site);
    const row = await accessibleSite(ctx, hostname, ctx.viewer);
    return row ? presentSite(row) : null;
  },
});

export const backfill = internalMutation({
  args: {
    source: v.union(v.literal("chats"), v.literal("workspaces")),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ continueCursor: v.string(), isDone: v.boolean(), processed: v.number() }),
  handler: async (ctx, { source, cursor }) => {
    const paginationOpts = {
      cursor,
      numItems: 32,
      maximumRowsRead: 32,
      maximumBytesRead: 256 * 1024,
    };
    if (source === "chats") {
      const page = await ctx.db.query("scoutChats").paginate(paginationOpts);
      for (const chat of page.page) await syncChatSite(ctx, chat);
      return {
        continueCursor: page.continueCursor,
        isDone: page.isDone,
        processed: page.page.length,
      };
    }
    const page = await ctx.db
      .query("scoutWorkspaces")
      .withIndex("by_site", (q) => q.gt("site", ""))
      .paginate(paginationOpts);
    for (const workspace of page.page) {
      if (workspace.kind !== "site") throw new Error("Expected a site workspace");
      await ensureSite(ctx, siteHostnameSchema.parse(workspace.site));
    }
    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      processed: page.page.length,
    };
  },
});
