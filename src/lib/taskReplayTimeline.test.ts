import { describe, expect, test } from "vite-plus/test";
import {
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
}): ReplayOperation {
  const tab = (tabId: string, url: string) => ({
    tabId,
    url,
    active: true,
  });
  return {
    sequence: args.sequence,
    state: {
      kind: "applied",
      telemetry: {
        before: {
          capturedAtMs: args.beforeMs,
          tabs: [tab(args.beforeTarget, args.beforeUrl ?? args.url)],
        },
        dispatchedAtMs: args.beforeMs + 5,
        after: {
          capturedAtMs: args.afterMs,
          tabs: [tab(args.afterTarget, args.afterUrl ?? args.url)],
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
        }),
      ],
    );

    expect(timeline.pageIdByTabId.get("target-a")).toBe("1");
    expect(timeline.pageIdByTabId.get("target-b")).toBe("2");
    expect(activeTabAt(timeline.points, 1_500)).toBe("target-a");
    expect(activeTabAt(timeline.points, 2_100)).toBe("target-b");
    expect(timeline.actionCount).toBe(2);
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

  test("hides Firecrawl's inactive bootstrap page and starts on the correlated recording", () => {
    const active = operation({
      sequence: 1,
      beforeMs: 1_000,
      afterMs: 3_000,
      beforeTarget: "t2",
      afterTarget: "t2",
      url: "https://samebase.com/pricing",
    });
    if (active.state.kind !== "applied") throw new Error("Expected applied operation");
    active.state.telemetry.before.tabs = [];
    active.state.telemetry.after.tabs.unshift({
      tabId: "t1",
      url: "about:blank",
      active: false,
    });

    const timeline = buildReplayTimeline(
      [
        { pageId: "0", pageUrl: null, startTimeMs: 0, endTimeMs: 12_000 },
        {
          pageId: "1",
          pageUrl: "https://samebase.com/pricing",
          startTimeMs: 2_000,
          endTimeMs: 12_000,
        },
      ],
      [active],
    );

    expect(timeline.pages.map((page) => page.pageId)).toEqual(["1"]);
    expect(timeline.pageIdByTabId.get("t2")).toBe("1");
    expect(activePageIdAt(timeline, 0)).toBe("1");
    expect(activePageIdAt(timeline, 2_000)).toBe("1");
  });

  test("correlates a uniquely matching URL across unrelated recording clocks", () => {
    const opened = operation({
      sequence: 1,
      beforeMs: 0,
      afterMs: 20_000,
      beforeTarget: "playwright-tab",
      afterTarget: "playwright-tab",
      url: "https://dash.cloudflare.com/",
    });
    if (opened.state.kind !== "applied") throw new Error("Expected applied operation");
    opened.state.telemetry.before.tabs = [];

    const timeline = buildReplayTimeline(
      [
        {
          pageId: "recorded-page",
          pageUrl: "https://dash.cloudflare.com/",
          startTimeMs: 0,
          endTimeMs: 70_000,
        },
      ],
      [opened],
    );

    expect(timeline.pages[0]?.binding).toEqual({
      kind: "correlated",
      tabId: "playwright-tab",
    });
    expect(activePageIdAt(timeline, 0)).toBe("recorded-page");
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
    });
    if (activeBlank.state.kind !== "applied") throw new Error("Expected applied operation");
    activeBlank.state.telemetry.before.tabs = [
      {
        tabId: "t1",
        url: "about:blank",
        active: true,
      },
    ];
    activeBlank.state.telemetry.after.tabs.unshift({
      tabId: "t1",
      url: "about:blank",
      active: false,
    });

    const timeline = buildReplayTimeline(
      [
        { pageId: "blank", pageUrl: null, startTimeMs: 0, endTimeMs: 2_000 },
        {
          pageId: "pricing",
          pageUrl: "https://samebase.com/pricing",
          startTimeMs: 0,
          endTimeMs: 2_000,
        },
      ],
      [activeBlank],
    );

    expect(timeline.pages.map((page) => page.pageId)).toEqual(["blank", "pricing"]);
  });

  test("does not bind two recordings to one tab that navigated between both URLs", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "page-a", pageUrl: "https://a.test/", startTimeMs: 0, endTimeMs: 5_000 },
        { pageId: "page-b", pageUrl: "https://b.test/", startTimeMs: 2_000, endTimeMs: 5_000 },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_100,
          beforeTarget: "t1",
          afterTarget: "t1",
          url: "https://a.test/",
        }),
        operation({
          sequence: 2,
          beforeMs: 2_000,
          afterMs: 2_100,
          beforeTarget: "t1",
          afterTarget: "t1",
          beforeUrl: "https://a.test/",
          afterUrl: "https://b.test/",
          url: "https://b.test/",
        }),
      ],
    );

    expect(timeline.pages.map((page) => page.binding)).toEqual([
      { kind: "ambiguous", candidateTabIds: ["t1"] },
      { kind: "ambiguous", candidateTabIds: ["t1"] },
    ]);
    expect(timeline.pageIdByTabId.size).toBe(0);
    expect(activePageIdAt(timeline, 0)).toBeNull();
  });

  test("places an after-observation at the time it was actually captured", () => {
    const switched = operation({
      sequence: 1,
      beforeMs: 1_000,
      afterMs: 1_100,
      beforeTarget: "t1",
      afterTarget: "t2",
      beforeUrl: "https://a.test/",
      afterUrl: "https://b.test/",
      url: "https://b.test/",
    });
    if (switched.state.kind !== "applied") throw new Error("Expected applied operation");
    switched.state.telemetry.after.capturedAtMs = 2_000;

    const timeline = buildReplayTimeline(
      [
        { pageId: "page-a", pageUrl: "https://a.test/", startTimeMs: 0, endTimeMs: 3_000 },
        { pageId: "page-b", pageUrl: "https://b.test/", startTimeMs: 0, endTimeMs: 3_000 },
      ],
      [switched],
    );

    expect(activeTabAt(timeline.points, 999)).toBe("t1");
    expect(activeTabAt(timeline.points, 1_000)).toBe("t2");
    expect(timeline.transitions).toContainEqual({
      sequence: 1,
      earliestTimeMs: 5,
      latestTimeMs: 1_000,
      fromTabId: "t1",
      toTabId: "t2",
    });
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
