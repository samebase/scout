import { describe, expect, test } from "vite-plus/test";
import {
  activeClickAt,
  activePageIdAt,
  activeTabAt,
  buildReplayTimeline,
  type ReplayOperation,
} from "./taskReplayTimeline";

function operation(args: {
  sequence: number;
  beforeMs: number;
  afterMs: number;
  beforeTarget: string;
  afterTarget: string;
  url: string;
  beforeUrl?: string;
  afterUrl?: string;
  kind?: string;
}): ReplayOperation {
  const tab = (tabId: string, url: string) => ({
    tabId,
    title: tabId,
    url,
    active: true,
  });
  return {
    sequence: args.sequence,
    action: { kind: args.kind ?? "click" },
    state: {
      kind: "applied",
      telemetry: {
        before: {
          capturedAtMs: args.beforeMs,
          tabs: [tab(args.beforeTarget, args.beforeUrl ?? args.url)],
        },
        dispatchedAtMs: args.beforeMs + 5,
        returnedAtMs: args.afterMs,
        after: {
          capturedAtMs: args.afterMs,
          tabs: [tab(args.afterTarget, args.afterUrl ?? args.url)],
        },
        pointer: {
          tabId: args.beforeTarget,
          ref: "@e1",
          box: { x: 10, y: 20, width: 80, height: 40 },
        },
      },
    },
  };
}

describe("task replay timeline", () => {
  test("reconstructs an explicit tab activation on one session clock", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "1", pageUrl: "https://a.test/", startTimeMs: 0, endTimeMs: 10_000 },
        {
          pageId: "2",
          pageUrl: "https://b.test/",
          startTimeMs: 2_000,
          endTimeMs: 10_000,
        },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_050,
          beforeTarget: "target-a",
          afterTarget: "target-a",
          url: "https://a.test/",
        }),
        operation({
          sequence: 2,
          beforeMs: 3_000,
          afterMs: 3_020,
          beforeTarget: "target-a",
          afterTarget: "target-b",
          url: "https://b.test/",
          beforeUrl: "https://a.test/",
          kind: "switch_tab",
        }),
      ],
    );

    expect(timeline.pageIdByTabId.get("target-a")).toBe("1");
    expect(timeline.pageIdByTabId.get("target-b")).toBe("2");
    expect(activeTabAt(timeline.points, 1_500)).toBe("target-a");
    expect(activeTabAt(timeline.points, 2_100)).toBe("target-b");
    expect(activeClickAt(timeline.events, "target-a", 10)).toMatchObject({ ref: "@e1" });
    expect(timeline.transitions).toContainEqual({
      sequence: 2,
      earliestTimeMs: 2_005,
      latestTimeMs: 2_020,
      fromTabId: "target-a",
      toTabId: "target-b",
    });
  });

  test("keeps duplicate URL tracks ambiguous", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "1", pageUrl: "https://login.test/", startTimeMs: 0, endTimeMs: 5_000 },
        {
          pageId: "2",
          pageUrl: "https://login.test/",
          startTimeMs: 1_000,
          endTimeMs: 5_000,
        },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_010,
          beforeTarget: "target-a",
          afterTarget: "target-b",
          url: "https://login.test/",
        }),
      ],
    );

    expect(timeline.pages.every((page) => page.binding.kind === "ambiguous")).toBe(true);
    expect(timeline.pageIdByTabId.size).toBe(0);
  });

  test("bounds a tab change first observed between operations", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "1", pageUrl: "https://a.test/", startTimeMs: 0, endTimeMs: 4_000 },
        { pageId: "2", pageUrl: "https://b.test/", startTimeMs: 0, endTimeMs: 4_000 },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_050,
          beforeTarget: "t1",
          afterTarget: "t1",
          url: "https://a.test/",
        }),
        operation({
          sequence: 2,
          beforeMs: 3_000,
          afterMs: 3_010,
          beforeTarget: "t2",
          afterTarget: "t2",
          url: "https://b.test/",
        }),
      ],
    );

    expect(timeline.transitions).toContainEqual({
      sequence: 2,
      earliestTimeMs: 50,
      latestTimeMs: 2_000,
      fromTabId: "t1",
      toTabId: "t2",
    });
  });

  test("keeps an unmatched provider page available for inspection", () => {
    const active = operation({
      sequence: 1,
      beforeMs: 1_000,
      afterMs: 3_000,
      beforeTarget: "t2",
      afterTarget: "t2",
      url: "https://samebase.com/pricing",
      kind: "open",
    });
    if (active.state.kind !== "applied") throw new Error("Expected applied operation");
    active.state.telemetry.before.tabs = [];
    active.state.telemetry.after.tabs.unshift({
      tabId: "t1",
      title: "about:blank",
      url: null,
      active: false,
    });

    const timeline = buildReplayTimeline(
      [
        { pageId: "blank", pageUrl: null, startTimeMs: 0, endTimeMs: 3_000 },
        {
          pageId: "pricing",
          pageUrl: "https://samebase.com/pricing",
          startTimeMs: 1_800,
          endTimeMs: 12_000,
        },
      ],
      [active],
    );

    expect(timeline.pages.map((page) => page.pageId)).toEqual(["blank", "pricing"]);
    expect(timeline.pages[0]?.binding).toEqual({ kind: "unmatched" });
    expect(timeline.pageIdByTabId.get("t2")).toBe("pricing");
    expect(activePageIdAt(timeline, 0)).toBeNull();
    expect(activePageIdAt(timeline, 2_000)).toBe("pricing");
  });

  test("keeps a blank page when Scout activates it", () => {
    const activeBlank = operation({
      sequence: 1,
      beforeMs: 1_000,
      afterMs: 1_100,
      beforeTarget: "t1",
      afterTarget: "t2",
      url: "https://samebase.com/pricing",
      beforeUrl: "about:blank",
      kind: "switch_tab",
    });

    const timeline = buildReplayTimeline(
      [
        { pageId: "blank", pageUrl: null, startTimeMs: 0, endTimeMs: 2_000 },
        {
          pageId: "pricing",
          pageUrl: "https://samebase.com/pricing",
          startTimeMs: 500,
          endTimeMs: 2_000,
        },
      ],
      [activeBlank],
    );

    expect(timeline.pages.map((page) => page.pageId)).toEqual(["blank", "pricing"]);
  });

  test("does not correlate one track and one tab when their URLs disagree", () => {
    const timeline = buildReplayTimeline(
      [{ pageId: "1", pageUrl: "https://a.test/", startTimeMs: 0, endTimeMs: 1_000 }],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_010,
          beforeTarget: "t1",
          afterTarget: "t1",
          url: "https://b.test/",
        }),
      ],
    );

    expect(timeline.pages[0]?.binding).toEqual({ kind: "unmatched" });
    expect(timeline.pageIdByTabId.size).toBe(0);
  });
});
