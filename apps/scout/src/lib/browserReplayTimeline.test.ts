import { describe, expect, test } from "vite-plus/test";
import {
  activePageIdAt,
  activeTabAt,
  buildReplayTimeline,
  replayPageUrlAt,
  type ReplayOperation,
} from "./browserReplayTimeline";

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
  test("shows the last observed URL of the selected tab, including when seeking backwards", () => {
    const timeline = buildReplayTimeline(
      [{ pageId: "1", pageUrl: "https://app.test/dashboard", startTimeMs: 0, endTimeMs: 8_000 }],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 2_000,
          beforeTarget: "t1",
          afterTarget: "t1",
          beforeUrl: "about:blank",
          url: "https://app.test/login",
        }),
        operation({
          sequence: 2,
          beforeMs: 3_000,
          afterMs: 4_000,
          beforeTarget: "t1",
          afterTarget: "t1",
          beforeUrl: "https://app.test/login",
          url: "https://app.test/dashboard",
        }),
      ],
    );
    const page = timeline.pages[0];
    expect(replayPageUrlAt(page, 0)).toBe("about:blank");
    expect(replayPageUrlAt(page, 999)).toBe("about:blank");
    expect(replayPageUrlAt(page, 1_000)).toBe("https://app.test/login");
    expect(replayPageUrlAt(page, 3_000)).toBe("https://app.test/dashboard");
    expect(replayPageUrlAt(page, 2_999)).toBe("https://app.test/login");
  });

  test("does not borrow a future URL before the first observation of a popup", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "1", pageUrl: "https://app.test/", startTimeMs: 0, endTimeMs: 8_000 },
        { pageId: "2", pageUrl: "https://login.test/", startTimeMs: 2_000, endTimeMs: 8_000 },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 4_000,
          beforeTarget: "t1",
          afterTarget: "t2",
          beforeUrl: "https://app.test/",
          url: "https://login.test/",
        }),
      ],
    );
    const page = timeline.pages[1];
    expect(replayPageUrlAt(page, 1_000)).toBeNull();
    expect(replayPageUrlAt(page, 2_999)).toBeNull();
    expect(replayPageUrlAt(page, 3_000)).toBe("https://login.test/");
  });

  test("uses the recording URL when there is no navigation history, without borrowing another tab's URL", () => {
    const timeline = buildReplayTimeline(
      [{ pageId: "1", pageUrl: "https://recorded.test/", startTimeMs: 0, endTimeMs: 8_000 }],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 2_000,
          beforeTarget: "t1",
          afterTarget: "t1",
          url: "https://other.test/",
        }),
      ],
    );
    const page = timeline.pages[0];
    expect(page.urlHistory).toEqual([]);
    expect(replayPageUrlAt(page, 3_000)).toBe("https://recorded.test/");
  });

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

  test("keeps the initial recording bound when a tab later visits another recording's URL", () => {
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
      { kind: "correlated", tabId: "t1" },
      { kind: "unmatched" },
    ]);
    expect(timeline.pageIdByTabId.size).toBe(1);
    expect(activePageIdAt(timeline, 0)).toBe("page-a");
  });

  test("follows the original tab, an OAuth popup, and a redirected dashboard", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "site", pageUrl: "https://app.test/", startTimeMs: 0, endTimeMs: 9_000 },
        {
          pageId: "login",
          pageUrl: "https://login.test/authorize",
          startTimeMs: 1_000,
          endTimeMs: 9_000,
        },
        {
          pageId: "dashboard",
          pageUrl: "https://dashboard.test/",
          startTimeMs: 4_000,
          endTimeMs: 9_000,
        },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_100,
          beforeTarget: "main",
          afterTarget: "main",
          url: "https://app.test/",
        }),
        operation({
          sequence: 2,
          beforeMs: 2_000,
          afterMs: 2_100,
          beforeTarget: "main",
          afterTarget: "popup",
          beforeUrl: "https://app.test/",
          url: "https://login.test/authorize",
        }),
        operation({
          sequence: 3,
          beforeMs: 3_000,
          afterMs: 3_100,
          beforeTarget: "main",
          afterTarget: "main",
          beforeUrl: "https://app.test/",
          url: "https://login.test/authorize",
        }),
        operation({
          sequence: 4,
          beforeMs: 5_000,
          afterMs: 5_100,
          beforeTarget: "main",
          afterTarget: "cloud",
          beforeUrl: "https://login.test/authorize",
          url: "https://dashboard.test/account/home",
        }),
      ],
    );
    expect(timeline.pages.map((page) => page.binding)).toEqual([
      { kind: "correlated", tabId: "main" },
      { kind: "correlated", tabId: "popup" },
      { kind: "correlated", tabId: "cloud" },
    ]);
    expect(activePageIdAt(timeline, 0)).toBe("site");
    expect(activePageIdAt(timeline, 1_100)).toBe("login");
    expect(activePageIdAt(timeline, 2_100)).toBe("site");
    expect(activePageIdAt(timeline, 4_100)).toBe("dashboard");
    expect(replayPageUrlAt(timeline.pages[0], 2_100)).toBe("https://login.test/authorize");
  });

  test("keeps redirects ambiguous when multiple tabs first appear on the same site", () => {
    const timeline = buildReplayTimeline(
      [
        { pageId: "a", pageUrl: "https://app.test/", startTimeMs: 0, endTimeMs: 5_000 },
        { pageId: "b", pageUrl: "https://app.test/", startTimeMs: 0, endTimeMs: 5_000 },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_100,
          beforeTarget: "a",
          afterTarget: "b",
          beforeUrl: "https://app.test/account/a",
          url: "https://app.test/account/b",
        }),
      ],
    );
    expect(timeline.pages.every((page) => page.binding.kind === "ambiguous")).toBe(true);
    expect(activePageIdAt(timeline, 0)).toBeNull();
  });

  test("does not take an exact URL match away from another recording to match a redirect", () => {
    const timeline = buildReplayTimeline(
      [
        {
          pageId: "exact",
          pageUrl: "https://app.test/account/a",
          startTimeMs: 0,
          endTimeMs: 5_000,
        },
        { pageId: "redirect", pageUrl: "https://app.test/", startTimeMs: 0, endTimeMs: 5_000 },
      ],
      [
        operation({
          sequence: 1,
          beforeMs: 1_000,
          afterMs: 1_100,
          beforeTarget: "a",
          afterTarget: "b",
          beforeUrl: "https://app.test/account/a",
          url: "https://app.test/account/b",
        }),
      ],
    );
    expect(timeline.pageIdByTabId.get("a")).toBe("exact");
    expect(timeline.pageIdByTabId.get("b")).toBe("redirect");
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
