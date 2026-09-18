import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type HlsType from "hls.js";
import { LoaderCircleIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { activePageIdAt, buildReplayTimeline } from "#lib/browserReplayTimeline";
import { CLICK_COLOR, replayClicks, visibleReplayClicks } from "#lib/browserReplayClicks";
import { BrowserReplayExport } from "./browser-replay-export";
import { BrowserReplayHeader } from "./browser-replay-header";

type ReplayPagesResult = FunctionReturnType<typeof api.browserReplay.listPages>;
type ReplayReady = Extract<ReplayPagesResult, { status: "ready" }>;
type BrowserSessionId = FunctionArgs<typeof api.browserReplay.listPages>["sessionId"];
type ReplayMode = "playback" | "inspector";

const REPLAY_PREPARATION_RETRIES = 10;
const REPLAY_RETRY_DELAY_MS = 2_000;

type ReplayLoadState =
  | { kind: "loading" | "processing" }
  | { kind: "ready"; replay: ReplayReady }
  | { kind: "unavailable" | "delayed" | "failed" };

type ReplaySelection = {
  selectedPageId: string | null;
  onSelectPage: (pageId: string | null) => void;
};

export function BrowserReplay(
  props: { sessionId: BrowserSessionId } & ReplaySelection &
    ({ mode: "playback"; header: ReactNode } | { mode: "inspector" }),
) {
  const { sessionId, mode, selectedPageId, onSelectPage } = props;
  const listPages = useAction(api.browserReplay.listPages);
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
  }, [listPages, sessionId, requestVersion]);

  return (
    <section
      className={
        mode === "playback"
          ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]"
          : "browser-replay"
      }
      aria-label={mode === "playback" ? "Replay" : undefined}
      aria-labelledby={mode === "inspector" ? "browser-replay-heading" : undefined}
    >
      {props.mode === "playback" ? (
        props.header
      ) : (
        <div className="flex min-w-0 items-center justify-between gap-2 border-b px-2 py-1.5 @xs:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <PlayIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <h3 id="browser-replay-heading" className="truncate text-xs font-semibold">
              Replay
            </h3>
          </div>
          <Button type="button" size="xs" variant="ghost" onClick={refresh}>
            <RotateCcwIcon />
            Refresh
          </Button>
        </div>
      )}
      {state.kind === "ready" ? (
        <>
          {mode === "inspector" && (
            <div className="browser-replay__narrow">Widen pane to view replay</div>
          )}
          <BrowserReplayPlayer
            replay={state.replay}
            requestVersion={requestVersion}
            sessionId={sessionId}
            mode={mode}
            onRetry={refresh}
            selectedPageId={selectedPageId}
            onSelectPage={onSelectPage}
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

function BrowserReplayPlayer({
  replay,
  requestVersion,
  sessionId,
  mode,
  onRetry,
  selectedPageId: requestedPageId,
  onSelectPage,
}: {
  replay: ReplayReady;
  requestVersion: number;
  sessionId: BrowserSessionId;
  mode: ReplayMode;
  onRetry: () => void;
} & ReplaySelection) {
  const loadPlaylist = useAction(api.browserReplay.loadPlaylist);
  const [playlistState, setPlaylistState] = useState<ReplayPlaylistsState>({ kind: "loading" });
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const currentTimeRef = useRef(0);
  const playbackAnchorRef = useRef({ currentTimeMs: 0, performanceMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [failedMediaPageIds, setFailedMediaPageIds] = useState<string[]>([]);
  const [showClicks, setShowClicks] = useState(true);
  const [clickOffsetMs, setClickOffsetMs] = useState(0);
  const timeline = useMemo(
    () => buildReplayTimeline(replay.pages, replay.operations),
    [replay.operations, replay.pages],
  );
  const selectedPageId =
    requestedPageId ??
    (mode === "playback" && replay.operations.length === 0
      ? (timeline.pages[0]?.pageId ?? null)
      : null);
  const clickData = useMemo(
    () => replayClicks(replay.operations, timeline, clickOffsetMs),
    [replay.operations, timeline, clickOffsetMs],
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
    setFailedMediaPageIds([]);
  }, [sessionId, requestVersion]);

  useEffect(() => {
    const page = timeline.pages.find((page) => page.pageId === selectedPageId);
    if (!page) return;
    setPlaying(false);
    if (
      currentTimeRef.current < page.relativeStartMs ||
      currentTimeRef.current > page.relativeEndMs
    ) {
      currentTimeRef.current = page.relativeStartMs;
      setCurrentTimeMs(page.relativeStartMs);
    }
  }, [selectedPageId, timeline.pages, requestVersion]);

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

  const automaticPageId = activePageIdAt(timeline, currentTimeMs);
  const activePageId = selectedPageId ?? automaticPageId;
  const activePage = timeline.pages.find((page) => page.pageId === activePageId) ?? null;

  const togglePlayback = () => {
    if (currentTimeRef.current >= timeline.durationMs) seek(0);
    setPlaying((current) => !current);
  };

  const selectPage = (pageId: string | null) => {
    onSelectPage(pageId);
    if (pageId === null) return;
    setPlaying(false);
    const page = timeline.pages.find((page) => page.pageId === pageId);
    if (page && (currentTimeMs < page.relativeStartMs || currentTimeMs > page.relativeEndMs)) {
      seek(page.relativeStartMs);
    }
  };

  if (playlistState.kind !== "ready") {
    if (mode === "playback") {
      return <ReplayStatus state={playlistState.kind} onRetry={onRetry} />;
    }
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
    <div
      className={mode === "playback" ? "flex min-h-0 flex-1 flex-col" : "browser-replay__player"}
    >
      <BrowserReplayHeader
        pages={timeline.pages}
        currentTimeMs={currentTimeMs}
        activePageId={activePageId}
        following={selectedPageId === null}
        onSelectPage={selectPage}
      />
      <div
        className={
          mode === "playback"
            ? "relative isolate min-h-0 flex-1 overflow-hidden bg-white"
            : "relative isolate overflow-hidden bg-neutral-950"
        }
        style={
          mode === "inspector"
            ? { aspectRatio: `${replay.viewport.width} / ${replay.viewport.height}` }
            : undefined
        }
      >
        {timeline.pages.map((page) => {
          const playlist = playlistState.playlists.get(page.pageId);
          if (!playlist) return null;
          return (
            <BrowserReplayTrack
              key={page.pageId}
              active={page.pageId === activePageId}
              localTimeSeconds={Math.max(0, currentTimeMs - page.relativeStartMs) / 1_000}
              onFailure={reportMediaFailure}
              pageId={page.pageId}
              playing={playing}
              playlist={playlist}
            />
          );
        })}
        {showClicks && activePageId && !activeTrackFailed ? (
          <svg
            className="pointer-events-none absolute inset-0 z-10 size-full"
            viewBox={`0 0 ${replay.viewport.width} ${replay.viewport.height}`}
            aria-hidden="true"
          >
            {visibleReplayClicks(clickData.clicks, currentTimeMs, activePageId).map((click) => (
              <circle
                key={click.id}
                cx={click.x * replay.viewport.width}
                cy={click.y * replay.viewport.height}
                r={(click.radius * replay.viewport.width) / 1280}
                opacity={click.opacity}
                fill="#38bdf833"
                stroke={CLICK_COLOR}
                strokeWidth={(4 * replay.viewport.width) / 1280}
              />
            ))}
          </svg>
        ) : null}
        {activeTrackFailed ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            {mode === "playback" ? (
              <>
                <p role="status">Couldn't play this recording.</p>
                <Button type="button" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              </>
            ) : (
              "This recording could not be played. Choose another track or refresh the replay."
            )}
          </div>
        ) : activePage === null ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            {mode === "playback"
              ? "Automatic tab following is unavailable here. Choose a recorded tab above."
              : "The active browser tab could not be matched to a recorded video track."}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t bg-background px-3 py-3 @md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={playing ? "Pause replay" : "Play replay"}
            onClick={togglePlayback}
            className={mode === "playback" ? "size-11" : undefined}
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
                seek(Number(event.currentTarget.value));
              }}
              aria-label="Replay position"
              className={
                mode === "playback"
                  ? "accent-primary block h-11 w-full cursor-pointer"
                  : "accent-primary block h-5 w-full cursor-pointer"
              }
            />
            {mode === "inspector" && (
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 h-0"
                aria-hidden="true"
              >
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
            )}
          </div>
          {mode === "playback" && (
            <BrowserReplayExport
              key={selectedPageId ?? "automatic"}
              sessionId={sessionId}
              timeline={timeline}
              manualPageId={selectedPageId}
              viewport={replay.viewport}
              clicks={showClicks ? clickData.clicks : []}
              mode="download"
            />
          )}
        </div>

        {mode === "inspector" && (
          <>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
              <span>
                {timeline.actionCount} {timeline.actionCount === 1 ? "action" : "actions"},{" "}
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
              Recordings match tabs by their initial address, including unambiguous redirects.
              {failedPageIds.size > 0
                ? ` ${failedPageIds.size} ${failedPageIds.size === 1 ? "recording could" : "recordings could"} not be loaded.`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showClicks}
                  onChange={(event) => setShowClicks(event.currentTarget.checked)}
                />
                Show clicks ({clickData.recorded})
              </label>
              {clickData.recorded > 0 ? (
                <label className="flex items-center gap-2">
                  Click timing (seconds)
                  <input
                    type="number"
                    step="0.1"
                    min="-60"
                    max="60"
                    value={clickOffsetMs / 1_000}
                    className="w-20 rounded border bg-background px-2 py-1"
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value))
                        setClickOffsetMs(Math.max(-60, Math.min(60, value)) * 1_000);
                    }}
                  />
                </label>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              {clickData.recorded === 0
                ? "No recorded clicks. Automatic markers require a new browser session with click capture enabled."
                : "Timing is approximate. Adjust it while reviewing, then export. Positive values show clicks later."}
              {clickData.unmapped > 0
                ? ` ${clickData.unmapped} clicks could not be matched to a recorded tab and will not be shown.`
                : ""}
              {clickData.recorded > 0 && clickData.incomplete
                ? " Some actions have missing or partial click capture."
                : ""}{" "}
              Captures top-level page clicks during agent actions. Iframe clicks and human-control
              intervals are not captured.
            </p>
            <BrowserReplayExport
              sessionId={sessionId}
              timeline={timeline}
              manualPageId={selectedPageId}
              viewport={replay.viewport}
              clicks={showClicks ? clickData.clicks : []}
              mode="inspector"
            />
          </>
        )}
      </div>
    </div>
  );
}

export function BrowserReplayTrack({
  active,
  localTimeSeconds,
  onFailure,
  pageId,
  playing,
  playlist,
}: {
  active: boolean;
  localTimeSeconds: number;
  onFailure: (pageId: string) => void;
  pageId: string;
  playing: boolean;
  playlist: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  const synchronizeTime = useCallback(
    (video: HTMLVideoElement) => {
      if (
        active &&
        Number.isFinite(video.duration) &&
        Math.abs(video.currentTime - localTimeSeconds) > 0.35
      ) {
        video.currentTime = Math.min(localTimeSeconds, Math.max(0, video.duration));
      }
    },
    [active, localTimeSeconds],
  );

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
    synchronizeTime(video);
    if (playing && video.paused) {
      void video.play().catch(() => undefined);
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [active, localTimeSeconds, playing, synchronizeTime]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      aria-label="Recorded Scout browser session"
      aria-hidden={!active}
      onLoadedMetadata={(event) => synchronizeTime(event.currentTarget)}
      onError={() => {
        setFailed(true);
        onFailure(pageId);
      }}
      className={`absolute inset-0 block size-full object-contain transition-opacity duration-150 motion-reduce:transition-none ${
        active && !failed ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    />
  );
}

function formatReplayTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
