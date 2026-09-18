import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRightIcon, LockIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "#components/ui/button";
import { SiteFilters } from "#components/site-filters";
import { ReviewCheckSummary } from "#components/review-checks";
import { LoadOnScroll } from "#components/load-on-scroll";
import { SitePreview } from "#components/site-preview";
import { SiteIdentity } from "#components/site-identity";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { cn } from "#lib/utils";
import { api } from "../../convex/_generated/api";
import { useViewerAccess } from "../lib/access";
import { BrowserReplayTrack } from "./browser-replay";
import { ScoutPiece } from "../products/play/scout-piece";
import { buildReplayTimeline } from "../lib/browserReplayTimeline";

type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
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
  const scope = viewer?.kind === "account" ? (search.scope ?? "public") : "public";
  const filters = { site: search.site, scope };
  return (
    <section aria-label="Reviews">
      <div className="mb-5">
        <SiteFilters
          search={filters}
          layout="toolbar"
          onChange={(search, options) => {
            void navigate({
              to: "/",
              search: (previous) => ({ ...previous, ...search }),
              ...options,
              resetScroll: false,
            });
          }}
        />
      </div>
      {scope === "mine" && !search.site && <UnassignedTasks search={filters} />}
      <SiteGroups key={`${scope}:${search.site ?? ""}`} search={filters} />
    </section>
  );
}

function UnassignedTasks({ search }: { search: ReviewFeedSearch }) {
  const tasks = usePaginatedQuery(api.scout.activity.unassigned, {}, { initialNumItems: 2 });
  if (!tasks.results.length) return null;
  return (
    <section aria-label="Tasks without a site" className="mb-5 rounded-lg border bg-card px-5">
      <h2 className="pt-4 text-sm font-medium text-muted-foreground">Tasks without a site</h2>
      {tasks.results.map((activity) => (
        <ReviewRow key={activity.threadId} activity={activity} preview={false} search={search} />
      ))}
      {(tasks.status === "CanLoadMore" || tasks.status === "LoadingMore") && (
        <Button
          variant="ghost"
          className="w-full border-t text-xs"
          disabled={tasks.status === "LoadingMore"}
          onClick={() => tasks.loadMore(2)}
        >
          {tasks.status === "LoadingMore" ? "Loading…" : "Show more tasks"}
        </Button>
      )}
    </section>
  );
}

function SiteGroups({ search }: { search: ReviewFeedSearch }) {
  const site = search.site ?? null;
  const scope = search.scope ?? "public";
  const sites = usePaginatedQuery(api.scout.sites.list, { site, scope }, { initialNumItems: 6 });
  return (
    <div className="space-y-5">
      {sites.results.map((site) => (
        <SiteCard key={site.hostname} site={site} search={search} />
      ))}
      {sites.status === "LoadingFirstPage" ? (
        <p role="status" className="py-12 text-muted-foreground">
          Loading sites…
        </p>
      ) : sites.status === "Exhausted" && !sites.results.length ? (
        <p className="py-12 text-muted-foreground">
          {site
            ? "No sites match your search."
            : scope === "mine"
              ? "Your reviews will appear here."
              : "No public reviews yet."}
        </p>
      ) : null}
      <LoadOnScroll status={sites.status} onLoad={() => sites.loadMore(6)} />
    </div>
  );
}

function SiteCard({
  site,
  search,
}: {
  site: FunctionReturnType<typeof api.scout.sites.list>["page"][number];
  search: ReviewFeedSearch;
}) {
  const scope = search.scope ?? "public";
  const tasks = usePaginatedQuery(
    api.scout.activity.list,
    { site: site.hostname, scope },
    { initialNumItems: 2 },
  );
  return (
    <article
      aria-label={site.hostname}
      className="w-full overflow-hidden rounded-lg border bg-card sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]"
    >
      <Link
        to="/sites/$site"
        params={{ site: site.hostname }}
        search={search}
        aria-label={`View ${site.profile?.name ?? site.hostname} details`}
        className="relative block min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:border-r"
      >
        <SitePreview site={site} className="sm:w-[clamp(18rem,calc(25vw+8rem),24rem)]" />
      </Link>
      <div className="flex min-h-60 min-w-0 flex-col px-4 sm:min-h-0 sm:px-5">
        <header className="relative shrink-0 border-b py-1.5 sm:max-lg:py-1">
          <Link
            to="/sites/$site"
            params={{ site: site.hostname }}
            search={search}
            aria-label={`View tasks for ${site.profile?.name ?? site.hostname}`}
            className="absolute inset-0 z-10 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <SiteIdentity site={site} heading="h2" />
        </header>
        <div className="flex-1 sm:min-h-0">
          {tasks.results.slice(0, 2).map((activity) => (
            <ReviewRow key={activity.threadId} activity={activity} preview search={search} />
          ))}
          {tasks.status === "LoadingFirstPage" && (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Loading tasks…
            </p>
          )}
          {tasks.status === "Exhausted" && !tasks.results.length && (
            <p className="py-6 text-sm text-muted-foreground">
              {scope === "mine" ? "You haven't reviewed this site yet." : "No public tasks yet."}
            </p>
          )}
        </div>
        <Button
          asChild
          variant="ghost"
          className="h-7 w-full shrink-0 rounded-none border-t py-1 text-xs font-normal text-primary"
        >
          <Link to="/sites/$site" params={{ site: site.hostname }} search={search}>
            {site.taskCount === 0
              ? "View site details"
              : site.taskCount === 1
                ? "View 1 task"
                : `View all ${site.taskCount} tasks`}
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function SiteTaskList({ site, search }: { site: string; search: ReviewFeedSearch }) {
  const scope = search.scope ?? "public";
  const tasks = usePaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 10 },
  );
  return (
    <section aria-label={`Tasks for ${site}`} className="min-w-0">
      <div className="rounded-lg border bg-card px-4 sm:px-5">
        {tasks.results.map((activity) => (
          <ReviewRow key={activity.threadId} activity={activity} preview={false} search={search} />
        ))}
        {tasks.status === "LoadingFirstPage" && (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            Loading tasks…
          </p>
        )}
        {tasks.status === "Exhausted" && !tasks.results.length && (
          <p className="py-6 text-sm text-muted-foreground">
            {scope === "mine" ? "You haven't reviewed this site yet." : "No public tasks yet."}
          </p>
        )}
      </div>
      <LoadOnScroll status={tasks.status} onLoad={() => tasks.loadMore(10)} />
    </section>
  );
}

function ReviewRow({
  activity,
  preview,
  search,
}: {
  activity: Activity;
  preview: boolean;
  search: ReviewFeedSearch;
}) {
  const checks = activity.walkthrough?.checks;
  const ongoing =
    activity.status === "ready" ||
    activity.status === "running" ||
    activity.status === "waiting" ||
    activity.status === "stopping";
  const showStatus =
    !checks || ongoing || activity.status === "failed" || activity.status === "stopped";
  return (
    <Link
      to="/tasks/$thread"
      params={{ thread: activity.threadId }}
      search={{
        ...search,
        view: activity.walkthrough ? "walkthrough" : "chat",
      }}
      className={cn(
        "group flex items-center gap-3 border-t outline-none first:border-t-0 focus-visible:ring-2 focus-visible:ring-ring",
        preview ? "py-1 sm:max-lg:py-0.5" : "py-4",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "flex items-start justify-between gap-x-3 gap-y-1.5",
            !preview && "flex-wrap",
          )}
        >
          <h3
            className={cn(
              "min-w-0 text-sm leading-snug font-medium wrap-anywhere group-hover:underline",
              preview ? "line-clamp-2 flex-1" : "min-[960px]:text-base",
            )}
          >
            {activity.title ?? "New review"}
          </h3>
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1",
              preview && "max-w-28 shrink-0",
            )}
          >
            {checks && !ongoing && <ReviewCheckSummary checks={checks} />}
            {showStatus && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {activity.status === "running" && (
                  <span className="size-1.5 rounded-full bg-primary" />
                )}
                {activityLabels[activity.status]}
              </span>
            )}
            {preview && activity.visibility === "private" && (
              <LockIcon className="size-3 text-muted-foreground" role="img" aria-label="Private" />
            )}
          </div>
        </div>
        <div className={cn(preview && "flex min-h-5 items-baseline gap-2")}>
          {activity.walkthrough && (
            <p
              className={cn(
                "text-sm wrap-anywhere text-muted-foreground",
                preview
                  ? "mt-1 min-w-0 flex-1 line-clamp-2 leading-5 sm:max-lg:hidden"
                  : "mt-1.5 line-clamp-2 leading-relaxed",
              )}
            >
              {activity.walkthrough.summary}
            </p>
          )}
          {!preview && activity.visibility === "private" && (
            <p className="mt-1 shrink-0 text-xs text-muted-foreground">Private</p>
          )}
        </div>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
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
