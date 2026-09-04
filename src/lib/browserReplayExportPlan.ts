import { z } from "zod";
import { activePageIdAt, type ReplayTimeline } from "./browserReplayTimeline";

export const REPLAY_EXPORT_FPS = 30;
export const MAX_REPLAY_EXPORT_DURATION_MS = 10 * 60 * 1_000;
export const MAX_REPLAY_EXPORT_BYTES = 100 * 1024 * 1024;

export const replayExportRequestSchema = z.object({
  width: z.number().int().min(2).max(1920),
  height: z.number().int().min(2).max(1920),
  spans: z
    .array(
      z.object({
        pageId: z.string(),
        playlist: z.string().max(2_000_000),
        fromMs: z.number().nonnegative(),
        toMs: z.number().positive(),
        pageStartMs: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(1_001),
  clicks: z
    .array(
      z.object({
        id: z.string(),
        pageId: z.string(),
        timeMs: z.number(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .max(32_000),
});
export type ReplayExportRequest = z.infer<typeof replayExportRequestSchema>;

export const replayExportMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("progress"), progress: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("done"), buffer: z.instanceof(ArrayBuffer) }),
  z.object({ kind: z.literal("failed"), message: z.string() }),
]);
export type ReplayExportMessage = z.infer<typeof replayExportMessageSchema>;

export function replayExportSpans(timeline: ReplayTimeline, manualPageId: string | null) {
  const spans: Array<Omit<ReplayExportRequest["spans"][number], "playlist">> = [];
  const selected = timeline.pages.find((page) => page.pageId === manualPageId);
  if (manualPageId && !selected) throw new Error("The selected recorded tab is unavailable.");
  const start = selected?.relativeStartMs ?? 0;
  const end = selected?.relativeEndMs ?? timeline.durationMs;
  if (end <= start) throw new Error("The replay has no video to export.");
  if (end - start > MAX_REPLAY_EXPORT_DURATION_MS) {
    throw new Error(
      "This browser export supports up to 10 minutes. Choose a shorter recorded tab.",
    );
  }
  const boundaries = [
    ...new Set([
      start,
      end,
      ...timeline.points.map((point) => point.timeMs),
      ...timeline.pages.flatMap((page) => [page.relativeStartMs, page.relativeEndMs]),
    ]),
  ]
    .filter((time) => time >= start && time <= end)
    .sort((left, right) => left - right);
  for (let index = 0; index < boundaries.length - 1; index++) {
    const fromMs = boundaries[index];
    const toMs = boundaries[index + 1];
    const pageId = manualPageId ?? activePageIdAt(timeline, (fromMs + toMs) / 2);
    const page = timeline.pages.find((candidate) => candidate.pageId === pageId);
    if (!page || fromMs < page.relativeStartMs || toMs > page.relativeEndMs) {
      throw new Error(
        "Part of the replay has no matched active tab. Select a recorded tab to export it.",
      );
    }
    const previous = spans.at(-1);
    if (previous?.pageId === page.pageId) previous.toMs = toMs;
    else spans.push({ pageId: page.pageId, fromMs, toMs, pageStartMs: page.relativeStartMs });
  }
  return spans;
}
