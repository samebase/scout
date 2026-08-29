export type ReplayPageTrack = {
  pageId: string;
  pageUrl: string | null;
  startTimeMs: number;
  endTimeMs: number;
};

type ReplayTabObservation = {
  tabId: string;
  title: string;
  url: string | null;
  active: boolean;
};

type ReplayTelemetry = {
  before: { capturedAtMs: number; tabs: ReplayTabObservation[] };
  dispatchedAtMs: number;
  returnedAtMs: number;
  after: { capturedAtMs: number; tabs: ReplayTabObservation[] };
  pointer: {
    tabId: string;
    ref: string;
    box: { x: number; y: number; width: number; height: number };
  } | null;
};

export type ReplayOperation = {
  sequence: number;
  action: { kind: string };
  state:
    | { kind: "prepared" }
    | { kind: "failed_before_dispatch" | "indeterminate_after_dispatch"; failure: string }
    | { kind: "applied" | "applied_snapshot_failed"; telemetry: ReplayTelemetry };
};

export type ReplayTrackBinding =
  | { kind: "correlated"; tabId: string; timingDifferenceMs: number }
  | { kind: "ambiguous"; candidateTabIds: string[] }
  | { kind: "unmatched" };

export type ReplayTimelinePoint = {
  sequence: number;
  timeMs: number;
  tabId: string;
};

export type ReplayTabTransition = {
  sequence: number;
  earliestTimeMs: number;
  latestTimeMs: number;
  fromTabId: string;
  toTabId: string;
};

export type ReplayActionEvent = {
  sequence: number;
  timeMs: number;
  kind: string;
  tabId: string | null;
  pointer: ReplayTelemetry["pointer"];
};

export type ReplayTimeline = {
  durationMs: number;
  pages: Array<
    ReplayPageTrack & {
      relativeStartMs: number;
      relativeEndMs: number;
      binding: ReplayTrackBinding;
    }
  >;
  points: ReplayTimelinePoint[];
  transitions: ReplayTabTransition[];
  events: ReplayActionEvent[];
  pageIdByTabId: Map<string, string>;
  hasIntegrityGap: boolean;
};

const MAX_CORRELATION_DIFFERENCE_MS = 5_000;

function activeTab(tabs: ReplayTabObservation[]) {
  const active = tabs.find((tab) => tab.active);
  return active?.tabId ?? null;
}

function settledOperations(operations: readonly ReplayOperation[]) {
  return operations.filter(
    (
      operation,
    ): operation is ReplayOperation & {
      state: Extract<ReplayOperation["state"], { kind: "applied" | "applied_snapshot_failed" }>;
    } => operation.state.kind === "applied" || operation.state.kind === "applied_snapshot_failed",
  );
}

export function buildReplayTimeline(
  pages: readonly ReplayPageTrack[],
  operations: readonly ReplayOperation[],
): ReplayTimeline {
  const settled = settledOperations(operations).sort(
    (left, right) => left.sequence - right.sequence,
  );
  const firstCaptureTime = Math.min(
    ...settled.map((operation) => operation.state.telemetry.before.capturedAtMs),
  );
  const telemetryOrigin = Number.isFinite(firstCaptureTime) ? firstCaptureTime : 0;
  const remoteToTimeline = (remoteMs: number) => Math.max(0, remoteMs - telemetryOrigin);

  const tabEvidence = new Map<string, { firstSeenMs: number; urls: Set<string>; title: string }>();
  for (const operation of settled) {
    for (const observation of [operation.state.telemetry.before, operation.state.telemetry.after]) {
      for (const tab of observation.tabs) {
        const existing = tabEvidence.get(tab.tabId);
        if (existing) {
          existing.firstSeenMs = Math.min(existing.firstSeenMs, observation.capturedAtMs);
          if (tab.url) existing.urls.add(tab.url);
          if (!existing.title && tab.title) existing.title = tab.title;
        } else {
          tabEvidence.set(tab.tabId, {
            firstSeenMs: observation.capturedAtMs,
            urls: new Set(tab.url ? [tab.url] : []),
            title: tab.title,
          });
        }
      }
    }
  }
  const orderedPages = [...pages].sort((left, right) => left.startTimeMs - right.startTimeMs);
  const firstPageTime = orderedPages[0]?.startTimeMs ?? 0;
  const lastPageTime = Math.max(firstPageTime, ...orderedPages.map((page) => page.endTimeMs));

  const bindingByPageId = new Map<string, ReplayTrackBinding>();
  for (const page of orderedPages) {
    const urlCandidates = [...tabEvidence.entries()].filter(
      ([, evidence]) => page.pageUrl !== null && evidence.urls.has(page.pageUrl),
    );
    const sameUrlPages = orderedPages.filter(
      (candidate) => page.pageUrl !== null && candidate.pageUrl === page.pageUrl,
    );
    if (urlCandidates.length === 1 && sameUrlPages.length === 1) {
      const candidate = urlCandidates[0];
      if (!candidate) continue;
      const timingDifferenceMs = Math.abs(
        remoteToTimeline(candidate[1].firstSeenMs) - (page.startTimeMs - firstPageTime),
      );
      bindingByPageId.set(
        page.pageId,
        timingDifferenceMs <= MAX_CORRELATION_DIFFERENCE_MS
          ? { kind: "correlated", tabId: candidate[0], timingDifferenceMs }
          : { kind: "unmatched" },
      );
      continue;
    }
    if (urlCandidates.length > 0) {
      bindingByPageId.set(page.pageId, {
        kind: "ambiguous",
        candidateTabIds: urlCandidates.map(([tabId]) => tabId),
      });
      continue;
    }
    bindingByPageId.set(page.pageId, { kind: "unmatched" });
  }

  const pageIdByTabId = new Map<string, string>();
  for (const [pageId, binding] of bindingByPageId) {
    if (binding.kind === "correlated") pageIdByTabId.set(binding.tabId, pageId);
  }

  const points: ReplayTimelinePoint[] = [];
  const transitions: ReplayTabTransition[] = [];
  const events: ReplayActionEvent[] = [];
  let previousObservation: { tabId: string; timeMs: number } | undefined;
  for (const operation of settled) {
    const telemetry = operation.state.telemetry;
    const beforeTabId = activeTab(telemetry.before.tabs);
    const afterTabId = activeTab(telemetry.after.tabs);
    if (beforeTabId) {
      const beforeTimeMs = remoteToTimeline(telemetry.before.capturedAtMs);
      if (previousObservation && previousObservation.tabId !== beforeTabId) {
        transitions.push({
          sequence: operation.sequence,
          earliestTimeMs: previousObservation.timeMs,
          latestTimeMs: beforeTimeMs,
          fromTabId: previousObservation.tabId,
          toTabId: beforeTabId,
        });
      }
      points.push({
        sequence: operation.sequence,
        timeMs: beforeTimeMs,
        tabId: beforeTabId,
      });
      previousObservation = { tabId: beforeTabId, timeMs: beforeTimeMs };
    }
    if (afterTabId) {
      const afterTimeMs = remoteToTimeline(telemetry.returnedAtMs);
      if (previousObservation && previousObservation.tabId !== afterTabId) {
        transitions.push({
          sequence: operation.sequence,
          earliestTimeMs: beforeTabId
            ? remoteToTimeline(telemetry.dispatchedAtMs)
            : previousObservation.timeMs,
          latestTimeMs: afterTimeMs,
          fromTabId: previousObservation.tabId,
          toTabId: afterTabId,
        });
      }
      points.push({
        sequence: operation.sequence,
        timeMs: afterTimeMs,
        tabId: afterTabId,
      });
      previousObservation = { tabId: afterTabId, timeMs: afterTimeMs };
    }
    events.push({
      sequence: operation.sequence,
      timeMs: remoteToTimeline(telemetry.dispatchedAtMs),
      kind: operation.action.kind,
      tabId: beforeTabId,
      pointer: telemetry.pointer,
    });
  }
  points.sort((left, right) => left.timeMs - right.timeMs);
  transitions.sort((left, right) => left.latestTimeMs - right.latestTimeMs);
  events.sort((left, right) => left.timeMs - right.timeMs);

  return {
    durationMs: Math.max(0, lastPageTime - firstPageTime),
    pages: orderedPages.map((page) => ({
      ...page,
      relativeStartMs: page.startTimeMs - firstPageTime,
      relativeEndMs: page.endTimeMs - firstPageTime,
      binding: bindingByPageId.get(page.pageId) ?? { kind: "unmatched" },
    })),
    points,
    transitions,
    events,
    pageIdByTabId,
    hasIntegrityGap: operations.some(
      (operation) =>
        operation.state.kind === "prepared" ||
        operation.state.kind === "indeterminate_after_dispatch",
    ),
  };
}

export function activeTabAt(points: readonly ReplayTimelinePoint[], timeMs: number) {
  let tabId: string | null = null;
  for (const point of points) {
    if (point.timeMs > timeMs) break;
    tabId = point.tabId;
  }
  return tabId;
}

export function activeClickAt(
  events: readonly ReplayActionEvent[],
  tabId: string | null,
  timeMs: number,
) {
  if (!tabId) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || timeMs - event.timeMs > 700) return null;
    if (
      event.timeMs <= timeMs &&
      event.tabId === tabId &&
      event.pointer &&
      event.kind === "click"
    ) {
      return event.pointer;
    }
  }
  return null;
}
