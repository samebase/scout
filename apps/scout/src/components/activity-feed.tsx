import { Link } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRightIcon,
  FocusIcon,
  Gamepad2Icon,
  MessageSquareIcon,
  PlayIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Badge } from "#components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import { api } from "../../convex/_generated/api";
import { useViewerAccess } from "../lib/access";
import { BrowserReplayTrack } from "./browser-replay";
import { ScoutPiece } from "../products/play/scout-piece";
import { productRoutes } from "../products/conversation/model";
import { buildReplayTimeline } from "../lib/browserReplayTimeline";

type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
const activityKind = z.enum(["all", "play", "review"]);
const activityScope = z.enum(["public", "mine"]);
const activityProducts = {
  play: { label: "Play", icon: Gamepad2Icon, className: "bg-play-sand text-play-ink" },
  review: { label: "Review", icon: FocusIcon, className: "bg-review-accent text-white" },
  general: { label: "Chat", icon: MessageSquareIcon, className: "bg-play-cloud text-play-ink" },
};
const activityLabels: Record<Activity["status"], string> = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting for help",
  finished: "Finished",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Interrupted",
};

export function ActivityFeed() {
  const [kind, setKind] = useState<z.infer<typeof activityKind>>("all");
  const viewer = useViewerAccess();
  const [scope, setScope] = useState<z.infer<typeof activityScope>>("public");
  const signedIn = viewer?.kind === "account";
  const selectedScope = signedIn ? scope : "public";
  const activities = usePaginatedQuery(
    api.scout.activity.list,
    { kind, scope: selectedScope },
    { initialNumItems: 8 },
  );
  return (
    <section aria-label="Activity">
      <div className="mb-2 flex flex-wrap items-center gap-3 border-b border-play-line pb-4">
        <Select value={kind} onValueChange={(value) => setKind(activityKind.parse(value))}>
          <SelectTrigger aria-label="Activity type" className="min-h-11 min-w-32 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="font-play-body">
            <SelectGroup>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="play">
                <Gamepad2Icon aria-hidden="true" />
                Play
              </SelectItem>
              <SelectItem value="review">
                <FocusIcon aria-hidden="true" />
                Review
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {signedIn && (
          <Select
            value={selectedScope}
            onValueChange={(value) => setScope(activityScope.parse(value))}
          >
            <SelectTrigger aria-label="Activity visibility" className="min-h-11 min-w-40 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="font-play-body">
              <SelectGroup>
                <SelectItem value="public">Public activity</SelectItem>
                <SelectItem value="mine">My activity</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>
      {activities.results.map((activity) => (
        <ActivityRow key={activity.threadId} activity={activity} />
      ))}
      {activities.status === "LoadingFirstPage" ? (
        <p role="status" className="py-12 text-play-muted">
          Loading activity…
        </p>
      ) : activities.results.length === 0 ? (
        <p className="py-16 text-play-muted">
          {selectedScope === "mine" ? "Your chats will appear here." : "No public activity yet."}
        </p>
      ) : null}
      {(activities.status === "CanLoadMore" || activities.status === "LoadingMore") && (
        <button
          type="button"
          className="mx-auto my-6 block min-h-11 rounded-xl border border-play-line px-5 text-sm"
          disabled={activities.status === "LoadingMore"}
          onClick={() => activities.loadMore(8)}
        >
          More activity
        </button>
      )}
    </section>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const product = activity.purpose.kind;
  const { label, icon: ProductIcon, className: badgeClassName } = activityProducts[product];
  const route = product === "general" ? "/chats" : productRoutes[product];
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "100px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return (
    <article
      ref={element}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="grid grid-cols-[minmax(220px,320px)_1fr] items-center gap-8 border-b border-play-line py-7 max-[640px]:grid-cols-1 max-[640px]:gap-4"
    >
      <Link
        to={route}
        search={{ thread: activity.threadId }}
        aria-label={`Watch ${activity.title ?? "chat"}`}
        className="group relative block aspect-[8/5] overflow-hidden rounded-2xl border border-play-line bg-play-cloud"
      >
        {visible && activity.latestSession ? (
          <ActivityPreview session={activity.latestSession} playing={hovered} />
        ) : (
          <PreviewPlaceholder />
        )}
        <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="grid size-12 place-items-center rounded-full bg-white/90 text-play-blue">
            <PlayIcon size={20} fill="currentColor" />
          </span>
        </span>
      </Link>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-play-muted">
          <Badge variant="secondary" className={badgeClassName}>
            <ProductIcon aria-hidden="true" />
            {label}
          </Badge>
          {activity.status === "running" && <span className="size-1.5 rounded-full bg-play-blue" />}
          <span>{activityLabels[activity.status]}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(activity.createdAt).toISOString()}>
            {new Date(activity.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </time>
          {activity.visibility === "private" && <span>· Private</span>}
        </div>
        <h2 className="text-xl leading-snug font-semibold tracking-[-0.4px] [overflow-wrap:anywhere]">
          <Link to={route} search={{ thread: activity.threadId }} className="hover:text-play-blue">
            {activity.title ?? "New chat"}
          </Link>
        </h2>
        <div className="mt-5 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm text-play-muted">
            <ScoutPiece size="brand" className="scale-65" />
            {activity.scout.displayName}
          </span>
          <Link
            to={route}
            search={{ thread: activity.threadId }}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-play-blue"
          >
            Watch <ArrowUpRightIcon size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="grid size-full place-items-center">
      <ScoutPiece className="scale-65 opacity-60" />
    </div>
  );
}

function ActivityPreview({
  session,
  playing,
}: {
  session: NonNullable<Activity["latestSession"]>;
  playing: boolean;
}) {
  const live = useQuery(
    api.scout.activity.liveView,
    session.kind === "active" ? { sessionId: session.sessionId } : "skip",
  );
  if (session.kind === "closed")
    return <ReplayPreview sessionId={session.sessionId} playing={playing} />;
  return live ? (
    <iframe
      src={live.url}
      title="Live game preview"
      tabIndex={-1}
      sandbox="allow-same-origin allow-scripts"
      referrerPolicy="no-referrer"
      className="pointer-events-none size-full border-0 bg-white"
    />
  ) : (
    <PreviewPlaceholder />
  );
}

function ReplayPreview({
  sessionId,
  playing,
}: {
  sessionId: NonNullable<Activity["latestSession"]>["sessionId"];
  playing: boolean;
}) {
  const listPages = useAction(api.browserReplay.listPages);
  const loadPlaylist = useAction(api.browserReplay.loadPlaylist);
  const [preview, setPreview] = useState<{
    pageId: string;
    playlist: string;
    positionSeconds: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listPages({ sessionId });
        if (result.status !== "ready" || cancelled) return;
        const page = buildReplayTimeline(result.pages, result.operations).pages[0];
        if (!page) return;
        const loaded = await loadPlaylist({ sessionId, pageId: page.pageId });
        if (!cancelled && loaded.status === "ready")
          setPreview({
            pageId: page.pageId,
            playlist: loaded.playlist,
            positionSeconds: (page.endTimeMs - page.startTimeMs) / 2_000,
          });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listPages, loadPlaylist, sessionId]);
  return preview && !failed ? (
    <BrowserReplayTrack
      active
      localTimeSeconds={preview.positionSeconds}
      onFailure={onFailure}
      pageId={preview.pageId}
      playing={playing}
      playlist={preview.playlist}
    />
  ) : (
    <PreviewPlaceholder />
  );
}
