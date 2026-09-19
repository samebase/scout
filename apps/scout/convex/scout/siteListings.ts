import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ViewerAccess } from "../access";
import { canAccess } from "../../shared/accessModel";
import { isPublicChat } from "./chatAccess";
import { updatePreviewPublication } from "./sitePreviewPublication";

export async function accessibleSite(ctx: QueryCtx, hostname: string, viewer: ViewerAccess) {
  const site = await ctx.db
    .query("sites")
    .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
    .unique();
  if (!site) return null;
  if (site.latestPublicTask !== null) return site;
  if (viewer.kind !== "account") return null;
  if (canAccess("access_lab", viewer.accessKeys)) return site;
  const own = await ctx.db
    .query("siteUserListings")
    .withIndex("by_user_id_and_hostname", (q) =>
      q.eq("userId", viewer.userId).eq("hostname", hostname),
    )
    .unique();
  return own ? site : null;
}

export async function ensureSite(ctx: MutationCtx, hostname: string): Promise<Id<"sites">> {
  const site = await ctx.db
    .query("sites")
    .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
    .unique();
  return (
    site?._id ??
    (await ctx.db.insert("sites", {
      hostname,
      latestPublicTask: null,
      taskCount: 0,
      publicTaskCount: 0,
    }))
  );
}

// Call after changing or deleting the chat, in the same mutation, with its previous document.
export async function syncChatSite(ctx: MutationCtx, before: Doc<"scoutChats">): Promise<void> {
  const after = await ctx.db.get(before._id);
  const publicSiteEligible = after?.purpose.kind === "review" && (await isPublicChat(ctx, after));
  if (after) {
    if (after.publicSiteEligible !== publicSiteEligible || !after.siteCounted)
      await ctx.db.patch(after._id, { publicSiteEligible, siteCounted: true });
  }
  const previous =
    before.siteCounted && before.purpose.kind === "review" ? before.primarySite : undefined;
  const current = after?.purpose.kind === "review" ? after.primarySite : undefined;
  const memberships = [before, after].flatMap((chat) =>
    chat?.purpose.kind === "review" && chat.primarySite
      ? [{ hostname: chat.primarySite, userId: chat.userId }]
      : [],
  );
  for (const hostname of new Set(memberships.map((entry) => entry.hostname))) {
    const siteId = await ensureSite(ctx, hostname);
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site listing has no site");
    const latest = await ctx.db
      .query("scoutChats")
      .withIndex("by_public_site_eligible_and_primary_site_and_created_at", (q) =>
        q.eq("publicSiteEligible", true).eq("primarySite", hostname),
      )
      .order("desc")
      .first();
    await ctx.db.patch(siteId, {
      latestPublicTask: latest ? { chatId: latest._id, createdAt: latest.createdAt } : null,
      taskCount: site.taskCount + Number(current === hostname) - Number(previous === hostname),
      publicTaskCount:
        site.publicTaskCount +
        Number(current === hostname && publicSiteEligible) -
        Number(previous === hostname && before.publicSiteEligible === true),
    });
    await updatePreviewPublication(ctx, site, latest !== null);
  }
  for (const [index, { hostname, userId }] of memberships.entries()) {
    if (
      memberships
        .slice(0, index)
        .some((entry) => entry.hostname === hostname && entry.userId === userId)
    )
      continue;
    const listing = await ctx.db
      .query("siteUserListings")
      .withIndex("by_user_id_and_hostname", (q) => q.eq("userId", userId).eq("hostname", hostname))
      .unique();
    const user = await ctx.db.get(userId);
    const latest =
      user && user.state !== "deleting" && user.state !== "deleted"
        ? await ctx.db
            .query("scoutChats")
            .withIndex("by_user_id_and_purpose_kind_and_primary_site_and_created_at", (q) =>
              q.eq("userId", userId).eq("purpose.kind", "review").eq("primarySite", hostname),
            )
            .order("desc")
            .first()
        : null;
    if (latest) {
      const latestTask = { chatId: latest._id, createdAt: latest.createdAt };
      const taskCount =
        (listing?.taskCount ?? 0) +
        Number(current === hostname && after?.userId === userId) -
        Number(previous === hostname && before.userId === userId);
      if (listing) await ctx.db.patch(listing._id, { latestTask, taskCount });
      else await ctx.db.insert("siteUserListings", { userId, hostname, latestTask, taskCount });
    } else if (listing) {
      await ctx.db.delete(listing._id);
    }
  }
}
