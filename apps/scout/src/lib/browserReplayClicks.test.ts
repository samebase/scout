import { describe, expect, test } from "vite-plus/test";
import { replayClicks, visibleReplayClicks, CLICK_DURATION_MS } from "./browserReplayClicks";
import { buildReplayTimeline, type ReplayOperation } from "./browserReplayTimeline";
import { replayExportSpans, replayExportRequestSchema } from "./browserReplayExportPlan";

const operation: ReplayOperation = {
  sequence: 1,
  state: {
    kind: "applied",
    telemetry: {
      before: {
        capturedAtMs: 10_000,
        tabs: [{ tabId: "a", url: "https://a.test/", active: true }],
      },
      dispatchedAtMs: 10_100,
      after: { capturedAtMs: 11_000, tabs: [{ tabId: "a", url: "https://a.test/", active: true }] },
    },
  },
};
const page = { pageId: "1", pageUrl: "https://a.test/", startTimeMs: 2_000, endTimeMs: 5_000 };
const timeline = buildReplayTimeline([page], [operation]);

describe("replay click overlays", () => {
  test("maps observed tabs, preserves normalized positions, and applies the review offset", () => {
    const result = replayClicks(
      [
        {
          sequence: 2,
          clickCapture: {
            kind: "captured",
            startedAtMs: 11_000,
            endedAtMs: 12_000,
            incomplete: false,
            truncated: false,
            clicks: [
              { tabId: "a", atMs: 11_200, x: 0.25, y: 0.75 },
              { tabId: "unknown", atMs: 11_250, x: 0.5, y: 0.5 },
            ],
          },
        },
      ],
      timeline,
      -200,
    );
    expect(result).toEqual({
      recorded: 2,
      unmapped: 1,
      incomplete: false,
      clicks: [{ id: "2-0", pageId: "1", timeMs: 1_000, x: 0.25, y: 0.75 }],
    });
    expect(visibleReplayClicks(result.clicks, 999, "1")).toEqual([]);
    expect(visibleReplayClicks(result.clicks, 1_000, "1")).toEqual([
      { ...result.clicks[0], radius: 12, opacity: 1 },
    ]);
    expect(visibleReplayClicks(result.clicks, 1_000 + CLICK_DURATION_MS, "1")).toEqual([]);
    expect(visibleReplayClicks(result.clicks, 1_001, "2")).toEqual([]);
  });

  test("does not invent clicks for old or unavailable recordings", () => {
    expect(
      replayClicks(
        [
          { sequence: 1, clickCapture: null },
          { sequence: 2, clickCapture: { kind: "unavailable" } },
        ],
        timeline,
        0,
      ),
    ).toEqual({ clicks: [], recorded: 0, unmapped: 0, incomplete: true });
  });
});

describe("replay export plan", () => {
  test("uses the recorded page's local time and exports a continuous session", () => {
    expect(replayExportSpans(timeline, null)).toEqual([
      { pageId: "1", fromMs: 0, toMs: 3_000, pageStartMs: 0 },
    ]);
  });

  test("rejects uncertain automatic matching but permits explicit tab selection", () => {
    const unmatched = buildReplayTimeline([{ ...page, pageUrl: null }], [operation]);
    expect(() => replayExportSpans(unmatched, null)).toThrow("Select a recorded tab");
    expect(replayExportSpans(unmatched, "1")).toHaveLength(1);
    expect(() => replayExportSpans(unmatched, "missing")).toThrow("unavailable");
  });

  test("follows confirmed tab changes without shifting a tab's source offset", () => {
    const second: ReplayOperation = {
      sequence: 2,
      state: {
        kind: "applied",
        telemetry: {
          before: {
            capturedAtMs: 11_000,
            tabs: [{ tabId: "a", url: "https://a.test/", active: true }],
          },
          dispatchedAtMs: 11_000,
          after: {
            capturedAtMs: 11_500,
            tabs: [{ tabId: "b", url: "https://b.test/", active: true }],
          },
        },
      },
    };
    const multi = buildReplayTimeline(
      [page, { pageId: "2", pageUrl: "https://b.test/", startTimeMs: 3_000, endTimeMs: 5_000 }],
      [operation, second],
    );
    expect(replayExportSpans(multi, null)).toEqual([
      { pageId: "1", fromMs: 0, toMs: 1_500, pageStartMs: 0 },
      { pageId: "2", fromMs: 1_500, toMs: 3_000, pageStartMs: 1_000 },
    ]);
    expect(replayExportSpans(multi, "2")).toEqual([
      { pageId: "2", fromMs: 1_000, toMs: 3_000, pageStartMs: 1_000 },
    ]);
  });

  test.each([45, 50])("accepts a %i-minute session or selected tab", (minutes) => {
    const durationMs = minutes * 60_000;
    const long = buildReplayTimeline(
      [{ ...page, endTimeMs: page.startTimeMs + durationMs }],
      [operation],
    );
    for (const selectedPageId of [null, "1"]) {
      expect(replayExportSpans(long, selectedPageId)).toEqual([
        { pageId: "1", fromMs: 0, toMs: durationMs, pageStartMs: 0 },
      ]);
    }
  });

  test("rejects sessions and selected tabs longer than 50 minutes", () => {
    const long = buildReplayTimeline(
      [{ ...page, endTimeMs: page.startTimeMs + 50 * 60_000 + 1 }],
      [operation],
    );
    for (const selectedPageId of [null, "1"]) {
      expect(() => replayExportSpans(long, selectedPageId)).toThrow("50 minutes");
    }
  });

  test("applies the limit to the selected tab's duration, not its end time", () => {
    const long = buildReplayTimeline(
      [
        page,
        {
          pageId: "2",
          pageUrl: "https://b.test/",
          startTimeMs: page.startTimeMs + 30 * 60_000,
          endTimeMs: page.startTimeMs + 80 * 60_000,
        },
      ],
      [operation],
    );
    expect(() => replayExportSpans(long, null)).toThrow("50 minutes");
    expect(replayExportSpans(long, "2")).toEqual([
      { pageId: "2", fromMs: 30 * 60_000, toMs: 80 * 60_000, pageStartMs: 30 * 60_000 },
    ]);
  });

  test("rejects invalid coordinates at the worker boundary", () => {
    expect(
      replayExportRequestSchema.safeParse({
        width: 1280,
        height: 800,
        spans: [{ ...replayExportSpans(timeline, null)[0], playlist: "#EXTM3U" }],
        clicks: [{ id: "bad", pageId: "1", timeMs: 0, x: 2, y: 0.5 }],
      }).success,
    ).toBe(false);
  });
});
