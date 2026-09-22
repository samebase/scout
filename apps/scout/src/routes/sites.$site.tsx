import { Link, createFileRoute } from "@tanstack/react-router";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { useLocalStorageSidebarState } from "../sidebars/scoutSidebarState";
import { useAction } from "convex/react";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useSsrPaginatedQuery } from "#lib/useSsrPaginatedQuery";
import { usePaginatedQuery as useStreamPaginatedQuery } from "convex-helpers/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, PanelLeftIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Suspense, useDeferredValue, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { Button, buttonVariants } from "#components/ui/button";
import { ScoutWorkspace } from "#components/scout-workspace";
import { SiteCard, SiteTaskList } from "#components/activity-feed";
import { SitePreviewCapture } from "#components/site-preview";
import { SiteIdentity } from "#components/site-identity";
import { SiteFilters } from "#components/site-filters";
import { SiteSearchLoading, SiteSearchResults } from "#components/site-search-results";
import { LoadOnScroll } from "#components/load-on-scroll";
import { reviewFeedSearch, type ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { canAccess, useViewerAccess } from "#lib/access";
import { siteHostnameSchema } from "../../shared/site";
import { ProductShell } from "../products/shell";

const searchSchema = z.object({
  file: z.string().startsWith("/workspace/").optional().catch(undefined),
  terminal: z.literal("hidden").optional().catch(undefined),
  ...reviewFeedSearch.shape,
  view: z.enum(["tasks", "workspace"]).optional(),
});

export const Route = createFileRoute("/sites/$site")({
  ssr: ({ search }) =>
    search.status === "success" &&
    search.value.scope !== "mine" &&
    search.value.view !== "workspace",
  staticData: { access: "access_public" },
  validateSearch: searchSchema,
  head: ({ params }) => ({ meta: [{ title: `${params.site} | TrailScout` }] }),
  component: SitePage,
});

const sidebarDefaults = {
  leftDesktopOpen: true,
  leftDesktopWidthPx: 240,
  leftMobileWidthPx: 280,
  mobilePane: "main",
  mobileSurface: { kind: "unmerged" },
  rightDesktopOpen: false,
  rightDesktopWidthPx: 0,
  rightMobileWidthPx: 0,
} satisfies SidebarLayoutState;

function SitePage() {
  const controller = useLocalStorageSidebarState({
    defaults: sidebarDefaults,
    storageKey: "scout_site_sidebar_state",
  });
  return (
    <ProductShell>
      <SidebarRuntimeProvider controller={controller}>
        <SiteLayout />
      </SidebarRuntimeProvider>
    </ProductShell>
  );
}

function SiteLayout() {
  const { site } = Route.useParams();
  const search = Route.useSearch();
  const parsed = siteHostnameSchema.safeParse(site);
  const viewer = useViewerAccess();
  const scope = viewer?.kind === "account" ? (search.scope ?? "public") : "public";
  const filters = { scope, site: search.site };

  return (
    <main id="main-content" className="h-[calc(100dvh-4rem)] min-h-[28rem]">
      <SidebarLayout
        mobileMinResizeBehavior="min_resize_to_slide"
        resizeHandleLabels={{ left: "Resize sites navigation", right: "Resize workspace" }}
        addressChrome={
          <header className="flex h-14 min-w-0 items-center gap-3 border-b px-3">
            <SitesToggle />
            <Link
              to="/"
              search={filters}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              All sites
            </Link>
          </header>
        }
        left={
          <Suspense fallback={<SiteSearchLoading />}>
            <SiteNavigation />
          </Suspense>
        }
        main={
          <PaneFrame
            scrollRestorationId="site-content"
            content={
              !parsed.success ? (
                <p className="p-6 text-muted-foreground">Site not found.</p>
              ) : (
                <Suspense fallback={<div className="min-h-full" aria-busy="true" />}>
                  <SiteContent site={parsed.data} />
                </Suspense>
              )
            }
          />
        }
      />
    </main>
  );
}

function SiteNavigation() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const viewer = useViewerAccess();
  const scope = viewer?.kind === "account" ? (search.scope ?? "public") : "public";
  const filters = { scope, site: search.site };
  const deferredScope = useDeferredValue(scope);
  const deferredSite = useDeferredValue(search.site);
  const [draftPending, setDraftPending] = useState(false);
  const { data: reviewedSiteCount } = useSuspenseQuery(
    convexQuery(api.scout.sites.count, { scope: deferredScope }),
  );
  return (
    <PaneFrame
      scrollRestorationId="site-navigation"
      header={
        <div className="site-navigation-filters mx-auto w-full max-w-page p-2">
          <SiteFilters
            search={filters}
            layout="sidebar"
            reviewedSiteCount={reviewedSiteCount}
            onPendingChange={setDraftPending}
            onChange={(filters, options) => {
              void navigate({
                search: (previous) => ({ ...previous, ...filters }),
                ...options,
                resetScroll: false,
              });
            }}
          />
        </div>
      }
      content={
        <nav aria-label="Sites" className="mx-auto w-full max-w-page p-2 text-sm">
          <SiteSearchResults
            pending={draftPending || scope !== deferredScope || search.site !== deferredSite}
          >
            <SiteNavigationResults search={{ scope: deferredScope, site: deferredSite }} />
          </SiteSearchResults>
        </nav>
      }
    />
  );
}

function SiteNavigationResults({ search }: { search: ReviewFeedSearch }) {
  const { site } = Route.useParams();
  const { view } = Route.useSearch();
  const parsed = siteHostnameSchema.safeParse(site);
  const viewer = useViewerAccess();
  const canInspect = viewer?.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const { setMobilePane } = useSidebarActions();
  const sites = useSsrPaginatedQuery(
    api.scout.sites.list,
    { scope: search.scope ?? "public", site: search.site ?? null },
    { initialNumItems: 20 },
    useStreamPaginatedQuery,
  );
  return (
    <>
      {sites.status !== "Exhausted" && !sites.results.length && <SiteSearchLoading />}
      <ul className="space-y-3">
        {sites.results.map((site) => (
          <li key={site.hostname}>
            <SiteCard
              site={site}
              search={search}
              navigation={{
                selected: site.hostname === parsed.data,
                view: canInspect && view === "workspace" ? "workspace" : "tasks",
                onNavigate: () => setMobilePane("main"),
              }}
            />
          </li>
        ))}
      </ul>
      {sites.status === "Exhausted" && sites.results.length === 0 && (
        <p className="p-2 text-muted-foreground">No sites match these filters.</p>
      )}
      <LoadOnScroll status={sites.status} onLoad={() => sites.loadMore(20)} />
    </>
  );
}

function SiteContent({ site }: { site: string }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const viewer = useViewerAccess();
  const canInspect = viewer?.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const scope = viewer?.kind === "account" ? (search.scope ?? "public") : "public";
  const filters = { scope, site: search.site };
  const workspace = canInspect && search.view === "workspace";
  const { data: record } = useSuspenseQuery(convexQuery(api.scout.sites.get, { site }));
  return record === null && viewer !== undefined ? (
    <p className="p-6 text-muted-foreground">Site not found.</p>
  ) : record === null ? (
    <div className="min-h-full" aria-busy="true" />
  ) : (
    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-page flex-col p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SiteIdentity site={record} heading="h1" />
        <div className="flex flex-wrap items-center gap-3">
          {canInspect && (
            <>
              <SiteResearchControl key={`research:${record.hostname}`} site={record} />
              <SitePreviewCapture key={`preview:${record.hostname}`} site={record} />
            </>
          )}
          <Link
            to="/"
            search={{ ...filters, taskSite: record.hostname }}
            className={buttonVariants()}
          >
            <PlusIcon aria-hidden="true" />
            New task
          </Link>
        </div>
      </div>
      {record.profile?.overview && (
        <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {record.profile.overview}
        </p>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b">
        <nav aria-label="Site views" className="flex gap-6">
          <Link
            to="/sites/$site"
            params={{ site }}
            search={{ ...filters, view: "tasks" }}
            resetScroll={false}
            aria-current={!workspace ? "page" : undefined}
            className={`border-b-2 py-3 text-sm font-medium ${!workspace ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Tasks
          </Link>
          {canInspect && (
            <Link
              to="/sites/$site"
              params={{ site }}
              search={{ ...filters, view: "workspace" }}
              resetScroll={false}
              aria-current={workspace ? "page" : undefined}
              className={`border-b-2 py-3 text-sm font-medium ${workspace ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Workspace
            </Link>
          )}
        </nav>
      </div>
      {workspace ? (
        <div className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <ScoutWorkspace
            key={site}
            target={{ kind: "site", site: site }}
            disabled={false}
            selectedPath={search.file ?? null}
            onSelectPath={(file) => {
              void navigate({ search: (previous) => ({ ...previous, file }) });
            }}
            terminalOpen={search.terminal !== "hidden"}
            onToggleTerminal={() => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  terminal: previous.terminal === "hidden" ? undefined : "hidden",
                }),
              });
            }}
          />
        </div>
      ) : (
        <Suspense fallback={<div className="min-h-40" aria-busy="true" />}>
          <SiteTaskList key={`${site}:${scope}`} site={site} search={filters} />
        </Suspense>
      )}
    </div>
  );
}

function SiteResearchControl({
  site,
}: {
  site: NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;
}) {
  const refresh = useAction(api.tasks.siteResearch.refresh);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy =
    pending || site.research?.status === "running" || site.research?.status === "waiting";
  const failure = error ?? (site.research?.status === "failed" ? site.research.error : null);
  return (
    <div className="min-w-0">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setPending(true);
          setError(null);
          void refresh({ site: site.hostname })
            .catch((cause) => {
              setError(cause instanceof Error ? cause.message : "Couldn't start research.");
            })
            .finally(() => setPending(false));
        }}
      >
        <SearchIcon aria-hidden="true" />
        {busy
          ? "Researching…"
          : site.research?.status === "failed" || site.research?.status === "cancelled"
            ? "Retry research"
            : site.profile === null
              ? "Research site"
              : "Refresh research"}
      </Button>
      {failure && (
        <p role="alert" className="mt-1 text-xs wrap-anywhere text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}

function SitesToggle() {
  const { isMobile, mobilePane, leftDesktopOpen } = useSidebarLayoutPresentation();
  const { setMobilePane, toggleLeftPane } = useSidebarActions();
  const shown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={shown ? (isMobile ? "Back to site" : "Hide sites") : "Show sites"}
      aria-pressed={shown}
      onClick={() => (isMobile ? setMobilePane(shown ? "main" : "left") : toggleLeftPane())}
    >
      <PanelLeftIcon aria-hidden="true" />
    </Button>
  );
}
