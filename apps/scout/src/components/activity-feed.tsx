import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRightIcon, ImagesIcon, PlayIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
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

type Activity = FunctionReturnType<typeof api.scout.activity.products>["page"][number];
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
  const selectedScope = signedIn ? (search.scope ?? "public") : "public";
  return (
    <section aria-label="Reviews">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        {signedIn ? (
          <Select
            value={selectedScope}
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
        ) : (
          <h2 className="text-lg font-medium">
            {search.site ? "Public reviews" : "Explore products"}
          </h2>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = draft.trim() ? siteHostnameSchema.safeParse(draft) : null;
            if (parsed && !parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setError(null);
            void navigate({
              to: "/",
              search: parsed
                ? { scope: selectedScope, site: parsed.data }
                : { scope: selectedScope },
            });
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
                void navigate({ to: "/", search: { scope: selectedScope } });
              }}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </form>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selectedScope === "public" && !search.site ? (
        <PublicProducts />
      ) : (
        <ReviewHistory site={search.site ?? null} scope={selectedScope} />
      )}
    </section>
  );
}

function PublicProducts() {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const products = useQuery(api.scout.activity.products, { afterSite: cursors.at(-1) ?? null });
  return (
    <div>
      {products === undefined ? (
        <p role="status" className="py-12 text-muted-foreground">
          Loading products…
        </p>
      ) : (
        <>
          {products.page.map((activity) => (
            <ActivityRow key={activity.threadId} activity={activity} scope="public" product />
          ))}
          {!products.page.length && (
            <p className="py-12 text-muted-foreground">No public products on this page yet.</p>
          )}
        </>
      )}
      {(cursors.length > 1 || products?.nextSite) && (
        <nav aria-label="Product pages" className="flex items-center justify-between py-5">
          <Button
            variant="outline"
            disabled={cursors.length === 1 || !products}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {cursors.length}</span>
          <Button
            variant="outline"
            disabled={!products?.nextSite}
            onClick={() => {
              if (products?.nextSite) setCursors((previous) => [...previous, products.nextSite]);
            }}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

function ReviewHistory({ site, scope }: { site: string | null; scope: "public" | "mine" }) {
  const activities = usePaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 8 },
  );
  return (
    <div>
      {site && (
        <h2 className="py-4 text-lg font-semibold [overflow-wrap:anywhere]">Reviews of {site}</h2>
      )}
      {activities.results.length > 0 && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[160px_minmax(0,1fr)_208px] gap-x-5 border-b border-border py-2 text-xs text-muted-foreground lg:grid"
        >
          <span className="col-span-2">Review</span>
          <span>Site</span>
        </div>
      )}
      {activities.results.map((activity) => (
        <ActivityRow key={activity.threadId} activity={activity} scope={scope} product={false} />
      ))}
      {activities.status === "LoadingFirstPage" ? (
        <p role="status" className="py-12 text-muted-foreground">
          Loading reviews…
        </p>
      ) : activities.results.length === 0 ? (
        <p className="py-16 text-muted-foreground">
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
          className="mx-auto my-6 flex"
          disabled={activities.status === "LoadingMore"}
          onClick={() => activities.loadMore(8)}
        >
          More reviews
        </Button>
      )}
    </div>
  );
}

function ActivityRow({
  activity,
  scope,
  product,
}: {
  activity: Activity;
  scope: "public" | "mine";
  product: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      {
        rootMargin: "100px",
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const preview = useQuery(
    api.scout.activity.preview,
    visible ? { threadId: activity.threadId } : "skip",
  );
  const hasWalkthrough =
    preview?.walkthroughSummary !== null && preview?.walkthroughSummary !== undefined;
  const destination = hasWalkthrough
    ? { thread: activity.threadId, view: "walkthrough" as const }
    : { thread: activity.threadId };
  return (
    <article
      ref={element}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={
        product
          ? "grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4 border-b border-border py-5 sm:grid-cols-[208px_minmax(0,1fr)] sm:items-center sm:gap-6"
          : "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b border-border py-3 sm:grid-cols-[144px_minmax(0,1fr)] lg:grid-cols-[160px_minmax(0,1fr)_208px] lg:gap-x-5"
      }
    >
      <Link
        to="/review"
        search={destination}
        aria-label={`Open ${activity.title ?? "review"}`}
        className="group relative row-span-2 block aspect-[8/5] overflow-hidden rounded-md border border-border bg-muted"
      >
        {preview?.screenshot ? (
          <ScreenshotPreview key={preview.screenshot.id} screenshot={preview.screenshot} />
        ) : visible && preview !== undefined && activity.latestSession ? (
          <ActivityPreview session={activity.latestSession} playing={hovered} />
        ) : (
          <PreviewPlaceholder />
        )}
        <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="grid size-8 place-items-center rounded-full bg-white/90 text-primary">
            {hasWalkthrough ? <ImagesIcon size={14} /> : <PlayIcon size={14} fill="currentColor" />}
          </span>
        </span>
      </Link>
      <div className="min-w-0 lg:row-span-2">
        {product && activity.primarySite && (
          <Link
            to="/"
            search={{ site: activity.primarySite, scope }}
            className="mb-1.5 block text-lg font-semibold text-primary [overflow-wrap:anywhere] hover:underline"
          >
            {activity.primarySite}
          </Link>
        )}
        <h2 className="text-sm leading-snug font-semibold [overflow-wrap:anywhere] sm:text-base">
          <Link
            to="/review"
            search={destination}
            className="line-clamp-2 hover:text-primary"
            title={activity.title ?? "New chat"}
          >
            {activity.title ?? "New chat"}
          </Link>
        </h2>
        {product && preview?.walkthroughSummary && (
          <p className="mt-2 hidden text-sm leading-relaxed text-muted-foreground sm:line-clamp-2">
            {preview.walkthroughSummary}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{activity.scout.displayName}</span>
          <span className="inline-flex items-center gap-1.5">
            {activity.status === "running" && <span className="size-1.5 rounded-full bg-primary" />}
            {activityLabels[activity.status]}
          </span>
          <time dateTime={new Date(activity.createdAt).toISOString()}>
            {new Date(activity.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </time>
          {activity.visibility === "private" && <span>Private</span>}
        </div>
        {product && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium sm:text-sm">
            <Link
              to="/review"
              search={destination}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {hasWalkthrough ? "Open walkthrough" : "Open review"}
              <ArrowUpRightIcon size={14} aria-hidden="true" />
            </Link>
            {activity.primarySite && (
              <Link
                to="/"
                search={{ site: activity.primarySite, scope }}
                className="text-muted-foreground hover:underline"
              >
                All reviews
              </Link>
            )}
          </div>
        )}
      </div>
      {!product &&
        (activity.primarySite ? (
          <div className="col-start-2 min-w-0 lg:col-start-3 lg:row-span-2">
            <Link
              to="/"
              search={{ site: activity.primarySite, scope }}
              className="inline-flex min-h-9 items-center break-all text-xs font-medium text-primary hover:underline sm:text-sm"
            >
              {activity.primarySite}
            </Link>
          </div>
        ) : (
          <span
            aria-label="Site not set"
            className="hidden text-sm text-muted-foreground lg:col-start-3 lg:row-span-2 lg:block"
          >
            —
          </span>
        ))}
    </article>
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
