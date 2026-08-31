import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type HlsType from "hls.js";
import { LoaderCircleIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import {
  activeClickAt,
  activePageIdAt,
  activeTabAt,
  buildReplayTimeline,
} from "#lib/taskReplayTimeline";

type ReplayPagesResult = FunctionReturnType<typeof api.taskReplay.listPages>;
type ReplayReady = Extract<ReplayPagesResult, { status: "ready" }>;
type BrowserSessionId = FunctionArgs<typeof api.taskReplay.listPages>["sessionId"];

const REPLAY_PREPARATION_RETRIES = 10;
const REPLAY_RETRY_DELAY_MS = 2_000;

type ReplayLoadState =
  | { kind: "loading" | "processing" }
  | { kind: "ready"; replay: ReplayReady }
  | { kind: "unavailable" | "delayed" | "failed" };

export function TaskReplay({ sessionId }: { sessionId: BrowserSessionId }) {
  const listPages = useAction(api.taskReplay.listPages);
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ReplayLoadState>({ kind: "loading" });
  const refresh = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    setState({ kind: "loading" });

    const load = async () => {
      try {
        const replay = await listPages({ sessionId });
        if (cancelled) return;
        if (replay.status === "ready") {
          if (replay.pages.length === 0) {
            setState({ kind: "delayed" });
            return;
          }
          setState({ kind: "ready", replay });
          return;
        }
        if (replay.status === "unavailable") {
          setState({ kind: "unavailable" });
          return;
        }
        attempt += 1;
        if (attempt >= REPLAY_PREPARATION_RETRIES) {
          setState({ kind: "delayed" });
          return;
        }
        setState({ kind: "processing" });
        retryTimer = window.setTimeout(() => void load(), REPLAY_RETRY_DELAY_MS);
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [listPages, requestVersion, sessionId]);

  return (
    <section className="task-replay" aria-labelledby="task-replay-heading">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b px-2 py-1.5 @xs:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PlayIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <h3 id="task-replay-heading" className="truncate text-xs font-semibold">
            Replay
          </h3>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={refresh}>
          <RotateCcwIcon />
          Refresh
        </Button>
      </div>
      {state.kind === "ready" ? (
        <>
          <div className="task-replay__narrow">Widen pane to view replay</div>
          <TaskReplayPlayer
            replay={state.replay}
            requestVersion={requestVersion}
            sessionId={sessionId}
          />
        </>
      ) : (
        <ReplayStatus state={state.kind} onRetry={refresh} />
      )}
    </section>
  );
}

function ReplayStatus({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: Exclude<ReplayLoadState["kind"], "ready">;
}) {
  const waiting = state === "loading" || state === "processing";
  const message = waiting
    ? "Preparing replay"
    : state === "unavailable"
      ? "No replay"
      : state === "delayed"
        ? "Replay still processing"
        : "Replay failed";
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
      <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        {waiting ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
        {message}
      </p>
      {!waiting && state !== "unavailable" ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcwIcon />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

type ReplayPlaylistsState =
  | { kind: "loading" }
  | { kind: "ready"; playlists: Map<string, string>; failedPageIds: string[] }
  | { kind: "failed" };

function TaskReplayPlayer({
  replay,
  requestVersion,
  sessionId,
}: {
  replay: ReplayReady;
  requestVersion: number;
  sessionId: BrowserSessionId;
}) {
  const loadPlaylist = useAction(api.taskReplay.loadPlaylist);
  const [playlistState, setPlaylistState] = useState<ReplayPlaylistsState>({ kind: "loading" });
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const currentTimeRef = useRef(0);
  const playbackAnchorRef = useRef({ currentTimeMs: 0, performanceMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [manualPageId, setManualPageId] = useState<string | null>(null);
  const [mediaAspectRatios, setMediaAspectRatios] = useState<Record<string, number>>({});
  const [failedMediaPageIds, setFailedMediaPageIds] = useState<string[]>([]);
  const timeline = useMemo(
    () => buildReplayTimeline(replay.pages, replay.operations),
    [replay.operations, replay.pages],
  );

  useEffect(() => {
    let cancelled = false;
    setPlaylistState({ kind: "loading" });

    void Promise.all(
      timeline.pages.map(async (page) => {
        for (let attempt = 0; attempt < REPLAY_PREPARATION_RETRIES; attempt += 1) {
          try {
            const result = await loadPlaylist({ sessionId, pageId: page.pageId });
            if (result.status === "ready") {
              return [page.pageId, result.playlist] as const;
            }
            if (result.status === "unavailable") return null;
          } catch {
            return null;
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, REPLAY_RETRY_DELAY_MS));
        }
        return null;
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const successful = loaded.filter(
        (entry): entry is readonly [string, string] => entry !== null,
      );
      if (successful.length === 0) {
        setPlaylistState({ kind: "failed" });
        return;
      }
      const playlists = new Map(successful);
      setPlaylistState({
        kind: "ready",
        playlists,
        failedPageIds: timeline.pages
          .filter((page) => !playlists.has(page.pageId))
          .map((page) => page.pageId),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadPlaylist, requestVersion, sessionId, timeline.pages]);

  useEffect(() => {
    currentTimeRef.current = 0;
    setCurrentTimeMs(0);
    setPlaying(false);
    setManualPageId(null);
    setFailedMediaPageIds([]);
  }, [sessionId, requestVersion]);

  const reportMediaFailure = useCallback((pageId: string) => {
    setFailedMediaPageIds((current) => (current.includes(pageId) ? current : [...current, pageId]));
  }, []);

  useEffect(() => {
    if (!playing) return;
    playbackAnchorRef.current = {
      currentTimeMs: currentTimeRef.current,
      performanceMs: performance.now(),
    };
    let frame = 0;
    let lastRender = 0;
    const tick = (now: number) => {
      const next = Math.min(
        timeline.durationMs,
        playbackAnchorRef.current.currentTimeMs + (now - playbackAnchorRef.current.performanceMs),
      );
      currentTimeRef.current = next;
      if (now - lastRender >= 50 || next === timeline.durationMs) {
        lastRender = now;
        setCurrentTimeMs(next);
      }
      if (next >= timeline.durationMs) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, timeline.durationMs]);

  const seek = (nextTimeMs: number) => {
    const bounded = Math.min(Math.max(0, nextTimeMs), timeline.durationMs);
    currentTimeRef.current = bounded;
    setCurrentTimeMs(bounded);
    if (playing) {
      playbackAnchorRef.current = { currentTimeMs: bounded, performanceMs: performance.now() };
    }
  };

  const activeTabId = activeTabAt(timeline.points, currentTimeMs);
  const automaticPageId = activePageIdAt(timeline, currentTimeMs);
  const activePageId = manualPageId ?? automaticPageId;
  const activePage = timeline.pages.find((page) => page.pageId === activePageId) ?? null;
  const pointer = activeClickAt(timeline.events, activeTabId, currentTimeMs);
  const viewportAspectRatio = replay.viewport.width / replay.viewport.height;
  const activeMediaAspectRatio = activePageId ? mediaAspectRatios[activePageId] : undefined;
  const pointerIsAccurate =
    pointer !== null &&
    activeMediaAspectRatio !== undefined &&
    Math.abs(activeMediaAspectRatio - viewportAspectRatio) / viewportAspectRatio < 0.02;

  const togglePlayback = () => {
    if (currentTimeRef.current >= timeline.durationMs) seek(0);
    setManualPageId(null);
    setPlaying((current) => !current);
  };

  if (playlistState.kind !== "ready") {
    return (
      <div
        className="flex items-center justify-center bg-neutral-950 px-4 text-center"
        style={{ aspectRatio: `${replay.viewport.width} / ${replay.viewport.height}` }}
      >
        <p className="flex items-center gap-2 text-sm text-neutral-300" role="status">
          {playlistState.kind === "loading" ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {playlistState.kind === "loading"
            ? `Loading ${timeline.pages.length} recorded ${timeline.pages.length === 1 ? "tab" : "tabs"}`
            : "The recorded tabs could not be loaded."}
        </p>
      </div>
    );
  }

  const failedPageIds = new Set([...playlistState.failedPageIds, ...failedMediaPageIds]);
  const activeTrackFailed = activePageId !== null && failedPageIds.has(activePageId);
  const unmatchedPageCount = timeline.pages.filter(
    (page) => page.binding.kind !== "correlated",
  ).length;

  return (
    <div className="task-replay__player">
      <div
        className="relative isolate overflow-hidden bg-neutral-950"
        style={{ aspectRatio: `${replay.viewport.width} / ${replay.viewport.height}` }}
      >
        {timeline.pages.map((page) => {
          const playlist = playlistState.playlists.get(page.pageId);
          if (!playlist) return null;
          return (
            <TaskReplayTrack
              key={page.pageId}
              active={page.pageId === activePageId}
              localTimeSeconds={Math.max(0, currentTimeMs - page.relativeStartMs) / 1_000}
              onAspectRatio={(ratio) =>
                setMediaAspectRatios((current) =>
                  current[page.pageId] === ratio ? current : { ...current, [page.pageId]: ratio },
                )
              }
              onFailure={reportMediaFailure}
              pageId={page.pageId}
              playing={playing}
              playlist={playlist}
            />
          );
        })}
        {activeTrackFailed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            This recording could not be played. Choose another track or refresh the replay.
          </div>
        ) : activePageId === null ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            A tab change was recorded, but Firecrawl did not expose enough identity data to match it
            to one video track.
          </div>
        ) : null}
        {pointerIsAccurate && pointer ? (
          <span
            className="pointer-events-none absolute z-20 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/50 shadow-[0_0_0_4px_rgba(0,0,0,0.35)] motion-safe:animate-ping"
            style={{
              left: `${((pointer.box.x + pointer.box.width / 2) / replay.viewport.width) * 100}%`,
              top: `${((pointer.box.y + pointer.box.height / 2) / replay.viewport.height) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="border-t bg-background px-3 py-3 @md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={playing ? "Pause replay" : "Play replay"}
            onClick={togglePlayback}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <span className="text-muted-foreground w-20 shrink-0 font-mono text-[11px] tabular-nums">
            {formatReplayTime(currentTimeMs)} / {formatReplayTime(timeline.durationMs)}
          </span>
          <div className="relative min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={Math.max(1, timeline.durationMs)}
              step={50}
              value={currentTimeMs}
              onChange={(event) => {
                setManualPageId(null);
                seek(Number(event.currentTarget.value));
              }}
              aria-label="Replay position"
              className="accent-primary block h-5 w-full cursor-pointer"
            />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0" aria-hidden="true">
              {timeline.transitions.map((transition) => (
                <span
                  key={`${transition.sequence}-${transition.fromTabId}-${transition.toTabId}`}
                  className="absolute top-[-6px] h-3 min-w-px bg-foreground/60"
                  style={{
                    left: `${(transition.earliestTimeMs / Math.max(1, timeline.durationMs)) * 100}%`,
                    width: `${Math.max(
                      0.15,
                      ((transition.latestTimeMs - transition.earliestTimeMs) /
                        Math.max(1, timeline.durationMs)) *
                        100,
                    )}%`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
          {timeline.pages.map((page, index) => (
            <button
              key={page.pageId}
              type="button"
              onClick={() => {
                setPlaying(false);
                setManualPageId(page.pageId);
                if (currentTimeMs < page.relativeStartMs || currentTimeMs > page.relativeEndMs) {
                  seek(page.relativeStartMs);
                }
              }}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                page.pageId === activePageId
                  ? "border-foreground/30 bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={page.pageId === activePageId}
            >
              {replayPageLabel(page, index)}
            </button>
          ))}
        </div>

        <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <span className="truncate">
            {activePage
              ? replayPageLabel(activePage, timeline.pages.indexOf(activePage))
              : "Unmatched tab"}
          </span>
          <span>
            {timeline.events.length} {timeline.events.length === 1 ? "action" : "actions"},{" "}
            {timeline.pages.length} recorded {timeline.pages.length === 1 ? "tab" : "tabs"}
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-[11px] leading-4">
          {timeline.hasIntegrityGap ? "The operation log contains an evidence gap. " : ""}
          {unmatchedPageCount > 0
            ? `${unmatchedPageCount} ${unmatchedPageCount === 1 ? "recording is" : "recordings are"} unmatched and ${unmatchedPageCount === 1 ? "remains" : "remain"} available for manual inspection. `
            : ""}
          {timeline.transitions.length > 0
            ? `${timeline.transitions.length} ${timeline.transitions.length === 1 ? "tab change is" : "tab changes are"} shown at the first confirming sample; each marker spans the interval in which the change occurred. `
            : "No tab change was observed. "}
          Tracks match automatically only when one URL and its start time identify one recorded tab.
          {failedPageIds.size > 0
            ? ` ${failedPageIds.size} ${failedPageIds.size === 1 ? "recording could" : "recordings could"} not be loaded.`
            : ""}
        </p>
      </div>
    </div>
  );
}

function TaskReplayTrack({
  active,
  localTimeSeconds,
  onAspectRatio,
  onFailure,
  pageId,
  playing,
  playlist,
}: {
  active: boolean;
  localTimeSeconds: number;
  onAspectRatio: (ratio: number) => void;
  onFailure: (pageId: string) => void;
  pageId: string;
  playing: boolean;
  playlist: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    const playlistUrl = URL.createObjectURL(
      new Blob([playlist], { type: "application/vnd.apple.mpegurl" }),
    );
    let cancelled = false;
    let hls: HlsType | undefined;

    const load = async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setFailed(true);
              onFailure(pageId);
            }
          });
          hls.loadSource(playlistUrl);
          hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playlistUrl;
          video.load();
        } else {
          setFailed(true);
          onFailure(pageId);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          onFailure(pageId);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(playlistUrl);
    };
  }, [onFailure, pageId, playlist]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - localTimeSeconds) > 0.35) {
      video.currentTime = Math.min(localTimeSeconds, video.duration || localTimeSeconds);
    }
    if (playing && video.paused) {
      void video.play().catch(() => undefined);
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [active, localTimeSeconds, playing]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      aria-label="Recorded Scout browser session"
      aria-hidden={!active}
      onError={() => {
        setFailed(true);
        onFailure(pageId);
      }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          onAspectRatio(video.videoWidth / video.videoHeight);
        }
      }}
      className={`absolute inset-0 block size-full object-contain transition-opacity duration-150 motion-reduce:transition-none ${
        active && !failed ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    />
  );
}

function replayPageLabel(
  page: { pageUrl: string | null; binding?: { kind: string } },
  index: number,
) {
  if (!page.pageUrl) {
    return page.binding?.kind === "unmatched"
      ? `Unmatched recording ${index + 1}`
      : `Tab ${index + 1}`;
  }
  const url = new URL(page.pageUrl);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

function formatReplayTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
