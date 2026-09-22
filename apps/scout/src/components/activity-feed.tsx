import { Link, useNavigate } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRightIcon, EarthIcon, LockKeyholeIcon } from "lucide-react";
import { Suspense, useCallback, useDeferredValue, useEffect, useState } from "react";
import { Button } from "#components/ui/button";
import { SiteFilters } from "#components/site-filters";
import { SiteSearchLoading, SiteSearchResults } from "#components/site-search-results";
import { ReviewCheckSummary } from "#components/review-checks";
import { LoadOnScroll } from "#components/load-on-scroll";
import { SitePreview } from "#components/site-preview";
import { SiteIdentity } from "#components/site-identity";
import { ScoutBadge } from "#components/scout-badge";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { useSsrPaginatedQuery } from "#lib/useSsrPaginatedQuery";
import { cn } from "#lib/utils";
import { api } from "../../convex/_generated/api";
import { useViewerAccess } from "../lib/access";
import { BrowserReplayTrack } from "./browser-replay";
import { ScoutMark } from "./scout-mark";
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
  const deferredScope = useDeferredValue(scope);
  const deferredSite = useDeferredValue(search.site);
  const [draftPending, setDraftPending] = useState(false);
  const { data: reviewedSiteCount } = useSuspenseQuery(
    convexQuery(api.scout.sites.count, { scope: deferredScope }),
  );
  const filters = { site: search.site, scope };
  return (
    <section
      aria-label="Reviews"
      aria-busy={scope !== deferredScope || search.site !== deferredSite}
    >
      <div className="mb-5">
        <SiteFilters
          search={filters}
          layout="toolbar"
          reviewedSiteCount={reviewedSiteCount}
          onPendingChange={setDraftPending}
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
      <SiteSearchResults
        pending={draftPending || scope !== deferredScope || search.site !== deferredSite}
      >
        <SiteGroups
          key={`${deferredScope}:${deferredSite ?? ""}`}
          search={{ scope: deferredScope, site: deferredSite }}
        />
      </SiteSearchResults>
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
          Show more tasks
        </Button>
      )}
    </section>
  );
}

function SiteGroups({ search }: { search: ReviewFeedSearch }) {
  const site = search.site ?? null;
  const scope = search.scope ?? "public";
  const sites = useSsrPaginatedQuery(api.scout.sites.list, { site, scope }, { initialNumItems: 6 });
  const rows = sites.results;
  const exhausted = sites.status === "Exhausted";
  return (
    <div className="min-h-60 space-y-5" aria-busy={sites.status === "LoadingFirstPage"}>
      {sites.status === "LoadingFirstPage" && !rows.length && <SiteSearchLoading />}
      {rows.map((site) => (
        <SiteCard key={site.hostname} site={site} search={search} navigation={null} />
      ))}
      {exhausted && !rows.length ? (
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

export function SiteCard({
  site,
  search,
  navigation,
}: {
  site: FunctionReturnType<typeof api.scout.sites.list>["page"][number];
  search: ReviewFeedSearch;
  navigation: {
    selected: boolean;
    view: "tasks" | "workspace";
    onNavigate: () => void;
  } | null;
}) {
  return (
    <article
      aria-label={site.hostname}
      data-active={navigation?.selected}
      className={cn(
        "site-card w-full overflow-hidden rounded-lg border bg-card",
        navigation
          ? "site-card-sidebar border-transparent hover:border-muted-foreground/40 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
          : "site-card-feed",
      )}
    >
      <div className="site-card-layout">
        <Link
          to="/sites/$site"
          params={{ site: site.hostname }}
          search={navigation ? { ...search, view: navigation.view } : search}
          resetScroll={navigation === null}
          onClick={navigation?.onNavigate}
          aria-current={navigation?.selected ? "page" : undefined}
          aria-label={`View ${site.profile?.name ?? site.hostname} details`}
          className="site-card-preview-link relative block min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <SitePreview site={site} className="site-card-preview" />
        </Link>
        <div className="site-card-content flex min-w-0 flex-col p-3">
          <header className="site-card-header relative shrink-0 border-b pb-2">
            <Link
              to="/sites/$site"
              params={{ site: site.hostname }}
              search={navigation ? { ...search, view: navigation.view } : search}
              resetScroll={navigation === null}
              onClick={navigation?.onNavigate}
              aria-current={navigation?.selected ? "page" : undefined}
              aria-label={`View tasks for ${site.profile?.name ?? site.hostname}`}
              className="absolute inset-0 z-10 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <SiteIdentity site={site} heading={navigation ? "span" : "h2"} />
          </header>
          <Suspense fallback={<div className="site-card-tasks flex-1" aria-busy="true" />}>
            <SiteCardTasks site={site.hostname} search={search} />
          </Suspense>
          <Button
            asChild
            variant="ghost"
            className="site-card-footer w-full shrink-0 rounded-none border-t text-xs font-normal text-primary"
          >
            <Link
              to="/sites/$site"
              params={{ site: site.hostname }}
              search={navigation ? { ...search, view: "tasks" } : search}
              resetScroll={navigation === null}
              onClick={navigation?.onNavigate}
            >
              {site.taskCount === 0
                ? "View site details"
                : site.taskCount === 1
                  ? "View 1 task"
                  : `View all ${site.taskCount} tasks`}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function SiteCardTasks({ site, search }: { site: string; search: ReviewFeedSearch }) {
  const scope = search.scope ?? "public";
  const tasks = useSsrPaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 2 },
  );
  return (
    <div className="site-card-tasks flex-1" aria-busy={tasks.status === "LoadingFirstPage"}>
      {tasks.results.slice(0, 2).map((activity) => (
        <ReviewRow key={activity.threadId} activity={activity} preview search={search} />
      ))}
      {tasks.status === "Exhausted" && !tasks.results.length && (
        <p className="py-6 text-sm text-muted-foreground">
          {scope === "mine" ? "You haven't reviewed this site yet." : "No public tasks yet."}
        </p>
      )}
    </div>
  );
}

export function SiteTaskList({ site, search }: { site: string; search: ReviewFeedSearch }) {
  const scope = search.scope ?? "public";
  const tasks = useSsrPaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 10 },
  );
  return (
    <section
      aria-label={`Tasks for ${site}`}
      aria-busy={tasks.status === "LoadingFirstPage"}
      className="@container/task-list min-h-40 min-w-0"
    >
      <div className="rounded-lg border bg-card px-2 @xs/task-list:px-4 @sm/task-list:px-5">
        {tasks.results.map((activity) => (
          <ReviewRow key={activity.threadId} activity={activity} preview={false} search={search} />
        ))}
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
  const VisibilityIcon = activity.visibility === "public" ? EarthIcon : LockKeyholeIcon;
  const ongoing =
    activity.status === "ready" ||
    activity.status === "running" ||
    activity.status === "waiting" ||
    activity.status === "stopping";
  const showStatus =
    !checks || ongoing || activity.status === "failed" || activity.status === "stopped";
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 border-t first:border-t-0 @max-xs/task-list:flex-wrap @max-xs/task-list:gap-2",
        preview ? "review-row-preview py-1 sm:max-lg:py-0.5" : "py-4",
      )}
    >
      <Link
        to="/tasks/$thread"
        params={{ thread: activity.threadId }}
        resetScroll={false}
        search={{ ...search, view: activity.walkthrough ? "walkthrough" : "chat" }}
        aria-label={activity.title ?? "New review"}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <VisibilityIcon
        className="mt-0.5 size-3.5 shrink-0 self-start text-muted-foreground"
        role="img"
        aria-label={activity.visibility === "public" ? "Public" : "Private"}
      />
      <div className="min-w-0 flex-1 @max-xs/task-list:order-last @max-xs/task-list:basis-full">
        <div
          className={cn(
            "flex items-start justify-between gap-x-3 gap-y-1.5",
            !preview && "flex-wrap",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 @max-xs/task-list:basis-full">
            <h3
              className={cn(
                "min-w-0 text-sm leading-snug font-medium wrap-anywhere group-hover:underline",
                preview ? "line-clamp-2" : "min-[960px]:text-base",
              )}
            >
              {activity.title ?? "New review"}
            </h3>
            <ScoutBadge scout={activity.scout} />
          </div>
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
          </div>
        </div>
        <div className={cn(preview && "flex min-h-5 items-baseline gap-2")}>
          {activity.walkthrough && (
            <p
              className={cn(
                "text-sm wrap-anywhere text-muted-foreground",
                preview
                  ? "review-row-summary mt-1 min-w-0 flex-1 line-clamp-2 leading-5 sm:max-lg:hidden"
                  : "mt-1.5 line-clamp-2 leading-relaxed",
              )}
            >
              {activity.walkthrough.summary}
            </p>
          )}
        </div>
      </div>
      <ArrowRightIcon
        className="size-4 shrink-0 text-muted-foreground @max-xs/task-list:ml-auto"
        aria-hidden="true"
      />
    </div>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="grid size-full place-items-center">
      <ScoutMark className="size-12 opacity-60" />
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
