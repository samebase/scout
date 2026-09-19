import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { publicPreviewKey } from "./sitePreviewModel";

export async function updatePreviewPublication(
  ctx: MutationCtx,
  site: Doc<"sites">,
  isPublic: boolean,
  retryFailed = false,
) {
  const preview = site.preview;
  if (preview?.kind !== "ready") return;
  const publication = preview.publication;
  if (!isPublic) {
    if (!publication || publication.kind === "private") return;
    await ctx.db.patch(site._id, {
      preview: { ...preview, publication: { kind: "private", version: publication.version } },
    });
    await ctx.scheduler.runAfter(0, internal.scout.publicSitePreviews.remove, {
      key: publicPreviewKey(preview.key, publication.version),
    });
    return;
  }
  if (
    publication &&
    publication.kind !== "private" &&
    !(retryFailed && publication.kind === "failed")
  )
    return;
  const version = (publication?.version ?? 0) + 1;
  await ctx.db.patch(site._id, {
    preview: { ...preview, publication: { kind: "publishing", version } },
  });
  await ctx.scheduler.runAfter(0, internal.scout.publicSitePreviews.publish, {
    siteId: site._id,
    sourceKey: preview.key,
    version,
  });
}
