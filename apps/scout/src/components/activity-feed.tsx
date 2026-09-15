import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ImagesIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { ReviewCheckSummary } from "#components/review-checks";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { siteHostnameSchema } from "../../shared/site";
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
import { buildReplayTimeline } from "../lib/browserReplayTimeline";

type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
const activityScope = z.enum(["public", "mine"]);
const activityLabels: Record<Activity["status"], string> = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting for help",
  finished: "Finished",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Interrupted",
};

export function ActivityFeed({ search }: { search: ReviewFeedSearch }) {
  const viewer = useViewerAccess();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(search.site ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(search.site ?? "");
    setError(null);
  }, [search.site]);
  const signedIn = viewer?.kind === "account";
  const scope = signedIn ? (search.scope ?? "public") : "public";
  return (
    <section aria-label="Reviews">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        {signedIn && (
          <Select
            value={scope}
            onValueChange={(value) => {
              void navigate({ to: "/", search: { ...search, scope: activityScope.parse(value) } });
            }}
          >
            <SelectTrigger aria-label="Review visibility" className="min-h-11 min-w-40 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectItem value="public">Public reviews</SelectItem>
                <SelectItem value="mine">My reviews</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = draft.trim() ? siteHostnameSchema.safeParse(draft) : null;
            if (parsed && !parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setError(null);
            void navigate({ to: "/", search: parsed ? { scope, site: parsed.data } : { scope } });
          }}
        >
          <Input
            aria-label="Filter by site"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Filter by site"
            className="min-h-11 w-52 bg-card max-[400px]:w-44"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Apply site filter">
            <SearchIcon aria-hidden="true" />
          </Button>
          {search.site && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear site filter"
              onClick={() => {
                void navigate({ to: "/", search: { scope } });
              }}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </form>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <SiteGroups key={`${scope}:${search.site ?? ""}`} site={search.site ?? null} scope={scope} />
    </section>
  );
}

function SiteGroups({ site, scope }: { site: string | null; scope: "public" | "mine" }) {
  const activities = usePaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 24 },
  );
  const groups = new Map<string | null, Activity[]>();
  for (const activity of activities.results) {
    const reviews = groups.get(activity.primarySite);
    if (reviews) reviews.push(activity);
    else groups.set(activity.primarySite, [activity]);
  }
  return (
    <div className="space-y-5">
      {Array.from(groups, ([hostname, reviews]) => (
        <SiteGroup
          key={hostname ?? "unassigned"}
          site={hostname}
          reviews={reviews}
          fullyLoaded={activities.status === "Exhausted"}
        />
      ))}
      {activities.status === "LoadingFirstPage" ? (
        <p role="status" className="py-12 text-muted-foreground">
          Loading reviews…
        </p>
      ) : activities.status === "Exhausted" && !activities.results.length ? (
        <p className="py-12 text-muted-foreground">
          {site
            ? "No reviews for this site yet."
            : scope === "mine"
              ? "Your reviews will appear here."
              : "No public reviews yet."}
        </p>
      ) : null}
      {(activities.status === "CanLoadMore" || activities.status === "LoadingMore") && (
        <Button
          type="button"
          variant="outline"
          className="mx-auto flex"
          disabled={activities.status === "LoadingMore"}
          onClick={() => activities.loadMore(24)}
        >
          {activities.status === "LoadingMore" ? "Loading…" : "More reviews"}
        </Button>
      )}
    </div>
  );
}

function SiteGroup({
  site,
  reviews,
  fullyLoaded,
}: {
  site: string | null;
  reviews: Activity[];
  fullyLoaded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const representative = reviews.find((review) => review.walkthrough) ?? reviews[0];
  const shown = expanded ? reviews : reviews.slice(0, 3);
  return (
    <article
      aria-label={site ?? "Other reviews"}
      className="overflow-hidden rounded-lg border bg-card min-[760px]:grid min-[760px]:grid-cols-[minmax(260px,36%)_minmax(0,1fr)]"
    >
      <header className="min-w-0 min-[760px]:border-r">
        <SitePreview activity={representative} />
        <h2 className="px-4 py-4 text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
          {site ?? "Other reviews"}
        </h2>
      </header>
      <div className="min-w-0 px-4 min-[760px]:px-5">
        {shown.map((activity) => (
          <ReviewRow key={activity.threadId} activity={activity} />
        ))}
        {reviews.length > 3 && (
          <Button
            variant="ghost"
            className="w-full rounded-none border-t py-3 text-xs font-normal text-primary"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : fullyLoaded ? `Show ${reviews.length - 3} more` : "Show more"}
            <ChevronDownIcon className={expanded ? "rotate-180" : ""} aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  );
}

function ReviewRow({ activity }: { activity: Activity }) {
  const checks = activity.walkthrough?.checks;
  const ongoing =
    activity.status === "ready" ||
    activity.status === "running" ||
    activity.status === "waiting" ||
    activity.status === "stopping";
  return (
    <Link
      to="/review"
      search={{ thread: activity.threadId, view: activity.walkthrough ? "walkthrough" : "chat" }}
      className="group flex items-center gap-3 border-t py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring min-[760px]:first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 text-sm leading-snug font-medium wrap-anywhere group-hover:underline min-[960px]:text-base">
            {activity.title ?? "New review"}
          </h3>
          {checks && !ongoing ? (
            <ReviewCheckSummary checks={checks} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {activity.status === "running" && (
                <span className="size-1.5 rounded-full bg-primary" />
              )}
              {activityLabels[activity.status]}
            </span>
          )}
        </div>
        {activity.walkthrough && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed wrap-anywhere text-muted-foreground">
            {activity.walkthrough.summary}
          </p>
        )}
        {activity.visibility === "private" && (
          <p className="mt-1 text-xs text-muted-foreground">Private</p>
        )}
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function SitePreview({ activity }: { activity: Activity }) {
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const preview = useQuery(
    api.scout.activity.preview,
    visible ? { threadId: activity.threadId } : "skip",
  );
  return (
    <Link
      ref={element}
      to="/review"
      search={{ thread: activity.threadId, view: activity.walkthrough ? "walkthrough" : "chat" }}
      aria-label={`Open ${activity.title ?? "review"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative block aspect-[8/5] overflow-hidden border-b bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {preview?.screenshot ? (
        <ScreenshotPreview key={preview.screenshot.id} screenshot={preview.screenshot} />
      ) : visible && preview !== undefined && activity.latestSession ? (
        <ActivityPreview
          key={activity.latestSession.sessionId}
          session={activity.latestSession}
          playing={hovered}
        />
      ) : (
        <PreviewPlaceholder />
      )}
      <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="grid size-8 place-items-center rounded-full bg-white/90 text-primary">
          {activity.walkthrough ? (
            <ImagesIcon size={14} />
          ) : (
            <PlayIcon size={14} fill="currentColor" />
          )}
        </span>
      </span>
    </Link>
  );
}

function ScreenshotPreview({
  screenshot,
}: {
  screenshot: NonNullable<
    NonNullable<FunctionReturnType<typeof api.scout.activity.preview>>["screenshot"]
  >;
}) {
  const imageUrl = useAction(api.agentsApi.screenshots.imageUrl);
  const [image, setImage] = useState<
    { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed" }
  >({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void imageUrl({ screenshotId: screenshot.id }).then(
      (result) => {
        if (!cancelled) setImage(result ? { kind: "ready", url: result.url } : { kind: "failed" });
      },
      () => {
        if (!cancelled) setImage({ kind: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl, screenshot.id]);
  if (image.kind === "failed")
    return (
      <span className="grid size-full place-items-center p-2 text-center text-xs text-muted-foreground">
        Preview unavailable
      </span>
    );
  if (image.kind === "loading") return <PreviewPlaceholder />;
  return (
    <img
      src={image.url}
      alt={screenshot.note}
      loading="lazy"
      decoding="async"
      className="size-full object-contain"
      onError={() => setImage({ kind: "failed" })}
    />
  );
}

function PreviewPlaceholder() {
  return (
    <div className="grid size-full place-items-center">
      <ScoutPiece className="scale-65 opacity-60" />
    </div>
  );
}

export function ActivityPreview({
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
      title="Live browser preview"
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
