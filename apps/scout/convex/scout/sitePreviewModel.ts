import { v } from "convex/values";
import { getRuntimeEnv } from "../runtimeEnv";

const publication = v.union(
  v.object({ kind: v.literal("private"), version: v.number() }),
  v.object({ kind: v.literal("publishing"), version: v.number() }),
  v.object({ kind: v.literal("public"), version: v.number() }),
  v.object({ kind: v.literal("failed"), version: v.number(), message: v.string() }),
);

export const previewPublicationArgs = v.object({
  siteId: v.id("sites"),
  sourceKey: v.string(),
  version: v.number(),
});

const capturing = v.object({ kind: v.literal("capturing"), startedAt: v.number() });
const ready = v.object({
  kind: v.literal("ready"),
  capturedAt: v.number(),
  key: v.string(),
  // Existing captures have no public copy until the manual publication backfill.
  publication: v.optional(publication),
});
const failed = v.object({
  kind: v.literal("failed"),
  failedAt: v.number(),
  message: v.string(),
});

export const sitePreviewFinished = v.union(ready, failed);
export const sitePreviewState = v.union(capturing, ready, failed);
export const sitePreviewMetadata = v.union(
  capturing,
  ready.omit("key", "publication"),
  failed,
  v.object({ kind: v.literal("public"), capturedAt: v.number(), url: v.string() }),
  v.object({ kind: v.literal("publishing"), capturedAt: v.number() }),
  v.object({ kind: v.literal("publication_failed"), capturedAt: v.number(), message: v.string() }),
);

export function publicPreviewKey(sourceKey: string, version: number) {
  const extension = sourceKey.slice(sourceKey.lastIndexOf("."));
  return `${sourceKey.slice(0, -extension.length)}/public-${version}${extension}`;
}

export function publicPreviewUrl(key: string) {
  const origin = getRuntimeEnv("PUBLIC_MEDIA_ORIGIN");
  if (!origin) throw new Error("PUBLIC_MEDIA_ORIGIN is not configured");
  return `${origin.replace(/\/$/, "")}/${key}`;
}

export function previewMetadata(
  preview: typeof sitePreviewState.type | undefined,
  isPublic: boolean,
): typeof sitePreviewMetadata.type | null {
  if (!preview) return null;
  switch (preview.kind) {
    case "ready":
      if (isPublic) {
        const state = preview.publication;
        if (state?.kind === "public")
          return {
            kind: "public",
            capturedAt: preview.capturedAt,
            url: publicPreviewUrl(publicPreviewKey(preview.key, state.version)),
          };
        if (state?.kind === "failed")
          return {
            kind: "publication_failed",
            capturedAt: preview.capturedAt,
            message: state.message,
          };
        return { kind: "publishing", capturedAt: preview.capturedAt };
      }
      return { kind: "ready", capturedAt: preview.capturedAt };
    case "capturing":
    case "failed":
      return preview;
    default: {
      const exhaustive: never = preview;
      return exhaustive;
    }
  }
}
