import type { Infer } from "convex/values";
import type { browserClickCaptureValidator } from "../../convex/browserModel";
import type { ReplayTimeline } from "./browserReplayTimeline";

export const CLICK_DURATION_MS = 700;
export const CLICK_COLOR = "#38bdf8";
export type ReplayClick = {
  id: string;
  pageId: string;
  timeMs: number;
  x: number;
  y: number;
};

export function replayClicks(
  operations: readonly {
    sequence: number;
    clickCapture: Infer<typeof browserClickCaptureValidator> | null;
  }[],
  timeline: ReplayTimeline,
  offsetMs: number,
) {
  let recorded = 0;
  let incomplete = false;
  const clicks: ReplayClick[] = [];
  for (const operation of operations) {
    const capture = operation.clickCapture;
    if (capture?.kind !== "captured") {
      incomplete = true;
      continue;
    }
    incomplete ||= capture.incomplete || capture.truncated;
    for (const [index, click] of capture.clicks.entries()) {
      recorded++;
      const pageId = timeline.pageIdByTabId.get(click.tabId);
      if (pageId)
        clicks.push({
          id: `${operation.sequence}-${index}`,
          pageId,
          timeMs: click.atMs - timeline.telemetryOriginMs + offsetMs,
          x: click.x,
          y: click.y,
        });
    }
  }
  clicks.sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id));
  return { clicks, recorded, unmapped: recorded - clicks.length, incomplete };
}

export function visibleReplayClicks(
  clicks: readonly ReplayClick[],
  timeMs: number,
  pageId: string | null,
) {
  let low = 0;
  let high = clicks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (clicks[middle].timeMs <= timeMs - CLICK_DURATION_MS) low = middle + 1;
    else high = middle;
  }
  const visible = [];
  for (let index = low; index < clicks.length; index++) {
    const click = clicks[index];
    if (click.timeMs > timeMs) break;
    if (click.pageId !== pageId) continue;
    const progress = (timeMs - click.timeMs) / CLICK_DURATION_MS;
    visible.push({ ...click, radius: 12 + 22 * progress, opacity: 1 - progress });
  }
  return visible;
}
