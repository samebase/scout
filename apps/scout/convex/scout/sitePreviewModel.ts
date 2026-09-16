import { v } from "convex/values";

const capturing = v.object({ kind: v.literal("capturing"), startedAt: v.number() });
const ready = v.object({ kind: v.literal("ready"), capturedAt: v.number(), key: v.string() });
const failed = v.object({
  kind: v.literal("failed"),
  failedAt: v.number(),
  message: v.string(),
});

export const sitePreviewFinished = v.union(ready, failed);
export const sitePreviewState = v.union(capturing, ready, failed);
export const sitePreviewMetadata = v.union(capturing, ready.omit("key"), failed);

export function previewMetadata(
  preview: typeof sitePreviewState.type | undefined,
): typeof sitePreviewMetadata.type | null {
  if (!preview) return null;
  switch (preview.kind) {
    case "ready":
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
