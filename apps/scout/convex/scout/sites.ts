import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { siteHostnameSchema, siteSearchSchema } from "../../shared/site";
import { omitNullish } from "../../shared/omitNullish";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { canAccess } from "../../shared/accessModel";
import { requireViewerPermission, type ViewerAccess } from "../access";
import { publicQuery } from "../functions";
import { accessibleSite, ensureSite, syncChatSite } from "./siteListings";
import { previewMetadata, sitePreviewMetadata } from "./sitePreviewModel";

import { siteProfile, researchSummary } from "../tasks/siteResearchModel";

const siteRow = v.object({
  hostname: v.string(),
  preview: v.union(sitePreviewMetadata, v.null()),
  profile: v.union(siteProfile.pick("name", "homepageUrl", "researchedAt"), v.null()),
  research: v.union(
    v.object({ status: researchSummary.fields.status, error: v.union(v.string(), v.null()) }),
    v.null(),
  ),
});

async function presentSite(ctx: QueryCtx, site: Doc<"sites">, viewer: ViewerAccess) {
  const research = site.researchId ? await ctx.db.get(site.researchId) : null;
  return {
    hostname: site.hostname,
    preview: previewMetadata(site.preview, site.latestPublicTask !== null),
    profile: site.profile
      ? {
          name: site.profile.name,
          homepageUrl: site.profile.homepageUrl,
          researchedAt: site.profile.researchedAt,
        }
      : null,
    research: research
      ? {
          status: research.state.kind,
          error:
            research.state.kind === "failed" &&
            viewer.kind === "account" &&
            canAccess("access_lab", viewer.accessKeys)
              ? research.state.error
              : null,
        }
      : null,
  };
}

export const list = publicQuery({
  access: "access_public",
  args: {
    scope: v.union(v.literal("public"), v.literal("mine"), v.literal("all")),
    site: v.union(v.string(), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(siteRow.extend({ taskCount: v.number() })),
  handler: async (ctx, args) => {
    const search = args.site === null ? "" : siteSearchSchema.parse(args.site);
    const matches = (site: Doc<"sites">) =>
      site.hostname.includes(search) ||
      (site.profile?.name.toLowerCase().includes(search) ?? false);
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, 24),
      maximumRowsRead: Math.min(args.paginationOpts.maximumRowsRead ?? 24, 24),
      maximumBytesRead: Math.min(args.paginationOpts.maximumBytesRead ?? 256 * 1024, 256 * 1024),
    };
    if (args.scope === "all") {
      requireViewerPermission(ctx.viewer, "access_lab");
      const rows = ctx.db.query("sites").withIndex("by_hostname");
      const page = await rows.order("asc").paginate(paginationOpts);
      return {
        ...page,
        page: await Promise.all(
          page.page.filter(matches).map(async (site) => ({
            ...(await presentSite(ctx, site, ctx.viewer)),
            taskCount: site.taskCount,
          })),
        ),
      };
    }
    if (args.scope === "mine") {
      const { userId } = requireViewerPermission(ctx.viewer, "access_account");
      const rows = ctx.db
        .query("siteUserListings")
        .withIndex("by_user_id_and_latest_task_created_at_and_hostname", (q) =>
          q.eq("userId", userId),
        );
      const page = await rows.order("desc").paginate(paginationOpts);
      const sites = await Promise.all(
        page.page.map(async ({ hostname, taskCount }) => {
          const site = await ctx.db
            .query("sites")
            .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
            .unique();
          if (!site) throw new Error("Site listing has no site");
          return { site, taskCount };
        }),
      );
      return {
        ...page,
        page: await Promise.all(
          sites
            .filter(({ site }) => matches(site))
            .map(async ({ site, taskCount }) => ({
              ...(await presentSite(ctx, site, ctx.viewer)),
              taskCount,
            })),
        ),
      };
    }
    const rows = ctx.db
      .query("sites")
      .withIndex("by_latest_public_task_created_at_and_hostname", (q) =>
        q.gt("latestPublicTask.createdAt", undefined),
      );
    const page = await rows.order("desc").paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.filter(matches).map(async (site) => ({
          ...(await presentSite(ctx, site, ctx.viewer)),
          taskCount: site.publicTaskCount,
        })),
      ),
    };
  },
});

export const get = publicQuery({
  access: "access_public",
  args: { site: v.string() },
  returns: v.union(
    siteRow.extend({ profile: v.union(siteProfile.omit("brief"), v.null()) }),
    v.null(),
  ),
  handler: async (ctx, { site }) => {
    const hostname = siteHostnameSchema.parse(site);
    const row = await accessibleSite(ctx, hostname, ctx.viewer);
    if (!row) return null;
    const result = await presentSite(ctx, row, ctx.viewer);
    return {
      ...result,
      profile: result.profile
        ? { ...result.profile, ...omitNullish({ overview: row.profile?.overview }) }
        : null,
    };
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
