export type ReplayPageTrack = {
  pageId: string;
  pageUrl: string | null;
  startTimeMs: number;
  endTimeMs: number;
};

type ReplayTabObservation = {
  tabId: string;
  url: string | null;
  active: boolean;
};

type ReplayTelemetry = {
  before: { capturedAtMs: number; tabs: ReplayTabObservation[] };
  dispatchedAtMs: number;
  after: { capturedAtMs: number; tabs: ReplayTabObservation[] };
};

export type ReplayOperation = {
  sequence: number;
  state:
    | { kind: "prepared" }
    | { kind: "failed_before_dispatch" | "indeterminate_after_dispatch"; failure: string }
    | { kind: "applied" | "applied_snapshot_failed"; telemetry: ReplayTelemetry };
};

export type ReplayTrackBinding =
  | { kind: "correlated"; tabId: string }
  | { kind: "ambiguous"; candidateTabIds: string[] }
  | { kind: "unmatched" };

export type ReplayTimelinePoint = {
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

export type ReplayTimeline = {
  telemetryOriginMs: number;
  durationMs: number;
  pages: Array<
    ReplayPageTrack & {
      relativeStartMs: number;
      relativeEndMs: number;
      binding: ReplayTrackBinding;
      urlHistory: Array<{ timeMs: number; url: string | null }>;
    }
  >;
  points: ReplayTimelinePoint[];
  transitions: ReplayTabTransition[];
  actionCount: number;
  pageIdByTabId: Map<string, string>;
  hasIntegrityGap: boolean;
};

type ReplayTabEvidence = {
  urls: Set<string>;
  observedAboutBlank: boolean;
  wasActive: boolean;
};

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

function withoutInactiveBootstrapPage(
  pages: readonly ReplayPageTrack[],
  tabEvidence: ReadonlyMap<string, ReplayTabEvidence>,
) {
  const firstPageTime = pages[0]?.startTimeMs;
  if (firstPageTime === undefined || pages.length < 2) return [...pages];

  const blankTabs = [...tabEvidence.values()].filter(
    (evidence) => evidence.observedAboutBlank && evidence.urls.size === 0,
  );
  if (blankTabs.length !== 1 || blankTabs[0]?.wasActive !== false) return [...pages];

  const bootstrapCandidates = pages.filter(
    (page) => page.pageUrl === null && page.startTimeMs === firstPageTime,
  );
  const hasWebPage = pages.some((page) => page.pageUrl !== null);
  if (bootstrapCandidates.length !== 1 || !hasWebPage) return [...pages];

  const bootstrapPageId = bootstrapCandidates[0]?.pageId;
  return pages.filter((page) => page.pageId !== bootstrapPageId);
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

  const tabEvidence = new Map<string, ReplayTabEvidence>();
  for (const operation of settled) {
    for (const observation of [operation.state.telemetry.before, operation.state.telemetry.after]) {
      for (const tab of observation.tabs) {
        const existing = tabEvidence.get(tab.tabId);
        if (existing) {
          if (tab.url && tab.url !== "about:blank") existing.urls.add(tab.url);
          existing.observedAboutBlank ||= tab.url === "about:blank";
          existing.wasActive ||= tab.active;
        } else {
          tabEvidence.set(tab.tabId, {
            urls: new Set(tab.url && tab.url !== "about:blank" ? [tab.url] : []),
            observedAboutBlank: tab.url === "about:blank",
            wasActive: tab.active,
          });
        }
      }
    }
  }
  const allOrderedPages = [...pages].sort((left, right) => left.startTimeMs - right.startTimeMs);
  const orderedPages = withoutInactiveBootstrapPage(allOrderedPages, tabEvidence);
  const firstPageTime = orderedPages[0]?.startTimeMs ?? 0;
  const lastPageTime = Math.max(firstPageTime, ...orderedPages.map((page) => page.endTimeMs));

  const bindingByPageId = new Map<string, ReplayTrackBinding>();
  const candidateTabIdsByPageId = new Map<string, string[]>();
  const candidatePageIdsByTabId = new Map<string, string[]>();
  for (const page of orderedPages) {
    const candidateTabIds = [...tabEvidence.entries()]
      .filter(([, evidence]) => page.pageUrl !== null && evidence.urls.has(page.pageUrl))
      .map(([tabId]) => tabId)
      .sort();
    candidateTabIdsByPageId.set(page.pageId, candidateTabIds);
    for (const tabId of candidateTabIds) {
      const candidatePageIds = candidatePageIdsByTabId.get(tabId) ?? [];
      candidatePageIds.push(page.pageId);
      candidatePageIdsByTabId.set(tabId, candidatePageIds);
    }
  }
  for (const page of orderedPages) {
    const candidateTabIds = candidateTabIdsByPageId.get(page.pageId) ?? [];
    const soleTabId = candidateTabIds.length === 1 ? candidateTabIds[0] : undefined;
    if (soleTabId && candidatePageIdsByTabId.get(soleTabId)?.length === 1) {
      bindingByPageId.set(page.pageId, { kind: "correlated", tabId: soleTabId });
    } else if (candidateTabIds.length > 0) {
      bindingByPageId.set(page.pageId, {
        kind: "ambiguous",
        candidateTabIds,
      });
    } else {
      bindingByPageId.set(page.pageId, { kind: "unmatched" });
    }
  }

  const pageIdByTabId = new Map<string, string>();
  for (const [pageId, binding] of bindingByPageId) {
    if (binding.kind === "correlated") pageIdByTabId.set(binding.tabId, pageId);
  }

  const points: ReplayTimelinePoint[] = [];
  const transitions: ReplayTabTransition[] = [];
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
        timeMs: beforeTimeMs,
        tabId: beforeTabId,
      });
      previousObservation = { tabId: beforeTabId, timeMs: beforeTimeMs };
    }
    if (afterTabId) {
      const afterTimeMs = remoteToTimeline(telemetry.after.capturedAtMs);
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
        timeMs: afterTimeMs,
        tabId: afterTabId,
      });
      previousObservation = { tabId: afterTabId, timeMs: afterTimeMs };
    }
  }
  points.sort((left, right) => left.timeMs - right.timeMs);
  transitions.sort((left, right) => left.latestTimeMs - right.latestTimeMs);
  const observations = settled
    .flatMap(({ state }) => [state.telemetry.before, state.telemetry.after])
    .sort((left, right) => left.capturedAtMs - right.capturedAtMs);

  return {
    telemetryOriginMs: telemetryOrigin,
    durationMs: Math.max(0, lastPageTime - firstPageTime),
    pages: orderedPages.map((page) => {
      const binding: ReplayTrackBinding = bindingByPageId.get(page.pageId) ?? { kind: "unmatched" };
      return {
        ...page,
        relativeStartMs: page.startTimeMs - firstPageTime,
        relativeEndMs: page.endTimeMs - firstPageTime,
        binding,
        urlHistory: observations.flatMap((observation) => {
          if (binding.kind !== "correlated") return [];
          const tab = observation.tabs.find((tab) => tab.tabId === binding.tabId);
          return tab ? [{ timeMs: remoteToTimeline(observation.capturedAtMs), url: tab.url }] : [];
        }),
      };
    }),
    points,
    transitions,
    actionCount: settled.length,
    pageIdByTabId,
    hasIntegrityGap: operations.some(
      (operation) =>
        operation.state.kind === "prepared" ||
        operation.state.kind === "indeterminate_after_dispatch",
    ),
  };
}

export function replayPageUrlAt(page: ReplayTimeline["pages"][number], timeMs: number) {
  if (timeMs < page.relativeStartMs) return null;
  // A provider URL describes the whole recording, not when a navigation happened.
  if (page.urlHistory.length === 0) return page.pageUrl;
  let url: string | null = null;
  for (const observation of page.urlHistory) {
    if (observation.timeMs > timeMs) break;
    url = observation.url;
  }
  return url;
}

export function activeTabAt(points: readonly ReplayTimelinePoint[], timeMs: number) {
  let tabId: string | null = null;
  for (const point of points) {
    if (point.timeMs > timeMs) break;
    tabId = point.tabId;
  }
  return tabId;
}

export function activePageIdAt(timeline: ReplayTimeline, timeMs: number) {
  const tabId = activeTabAt(timeline.points, timeMs);
  if (tabId) return timeline.pageIdByTabId.get(tabId) ?? null;

  const candidates = timeline.pages.filter(
    (page) =>
      page.binding.kind === "correlated" &&
      page.relativeStartMs <= timeMs &&
      page.relativeEndMs >= timeMs,
  );
  return candidates.length === 1 ? (candidates[0]?.pageId ?? null) : null;
}
