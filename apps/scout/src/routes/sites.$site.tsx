import { Link, createFileRoute } from "@tanstack/react-router";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, ArrowUpRightIcon, PanelLeftIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { ScoutWorkspace } from "#components/scout-workspace";
import { SiteTaskList } from "#components/activity-feed";
import { SitePreview, SitePreviewCapture } from "#components/site-preview";
import { SiteIdentity } from "#components/site-identity";
import { LoadOnScroll } from "#components/load-on-scroll";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import { chatSearchSchema } from "#lib/chat-search";
import { canAccess, useViewerAccess } from "#lib/access";
import { siteHostnameSchema } from "../../shared/site";
import { ProductShell } from "../products/shell";

const scopeSchema = z.enum(["public", "mine"]);
const searchSchema = chatSearchSchema.pick({ file: true, terminal: true }).extend({
  view: z.enum(["tasks", "workspace"]).optional(),
  scope: scopeSchema.optional(),
});

export const Route = createFileRoute("/sites/$site")({
  staticData: { access: "access_public" },
  validateSearch: searchSchema,
  head: ({ params }) => ({ meta: [{ title: `${params.site} | Scout` }] }),
  component: SitePage,
});

function SitePage() {
  const [state, setState] = useState<SidebarLayoutState>({
    leftDesktopOpen: true,
    leftDesktopWidthPx: 240,
    leftMobileWidthPx: 280,
    mobilePane: "main",
    mobileSurface: { kind: "unmerged" },
    rightDesktopOpen: false,
    rightDesktopWidthPx: 0,
    rightMobileWidthPx: 0,
  });
  return (
    <ProductShell product="review">
      <SidebarRuntimeProvider controller={{ isHydrated: true, state, setState }}>
        <SiteLayout />
      </SidebarRuntimeProvider>
    </ProductShell>
  );
}

function SiteLayout() {
  const { site } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const parsed = siteHostnameSchema.safeParse(site);
  const viewer = useViewerAccess();
  const signedIn = viewer?.kind === "account";
  const canInspect = signedIn && canAccess("access_lab", viewer.accessKeys);
  const scope = signedIn ? (search.scope ?? "public") : "public";
  const workspace = canInspect && search.view === "workspace";
  const record = useQuery(api.scout.sites.get, parsed.success ? { site: parsed.data } : "skip");
  const { setMobilePane } = useSidebarActions();
  const sites = usePaginatedQuery(
    api.scout.sites.list,
    { scope, site: null },
    { initialNumItems: 20 },
  );

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
              search={{ scope }}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              All sites
            </Link>
          </header>
        }
        left={
          <PaneFrame
            scrollRestorationId="site-navigation"
            content={
              <nav aria-label="Sites" className="p-2 text-sm">
                {sites.status === "LoadingFirstPage" && (
                  <p role="status" className="p-2 text-muted-foreground">
                    Loading sites…
                  </p>
                )}
                <ul className="space-y-3">
                  {sites.results.map((site) => (
                    <li key={site.hostname}>
                      <Link
                        to="/sites/$site"
                        params={{ site: site.hostname }}
                        activeOptions={{ includeSearch: false }}
                        search={{ scope, view: workspace ? "workspace" : "tasks" }}
                        onClick={() => setMobilePane("main")}
                        className="group block overflow-hidden rounded-md border border-transparent bg-card hover:border-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-primary aria-[current=page]:bg-primary/5 aria-[current=page]:font-medium"
                      >
                        <SitePreview site={site} />
                        <div className="p-2.5">
                          <SiteIdentity site={site} heading="span" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
                <LoadOnScroll status={sites.status} onLoad={() => sites.loadMore(20)} />
              </nav>
            }
          />
        }
        main={
          <PaneFrame
            scrollRestorationId="site-content"
            content={
              !parsed.success || record === null ? (
                <p className="p-6 text-muted-foreground">Site not found.</p>
              ) : record === undefined ? (
                <p role="status" className="p-6 text-muted-foreground">
                  Loading site…
                </p>
              ) : (
                <div className="flex min-h-full flex-col p-4 sm:p-6">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <SiteIdentity site={record} heading="h1" />
                    <div className="flex flex-wrap items-center gap-3">
                      {canInspect && (
                        <>
                          <SiteResearchControl key={`research:${record.hostname}`} site={record} />
                          <SitePreviewCapture key={`preview:${record.hostname}`} site={record} />
                        </>
                      )}
                      <a
                        href={
                          record.profile === null
                            ? `https://${record.hostname}`
                            : record.profile.homepageUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                      >
                        Visit website <ArrowUpRightIcon className="size-4" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b">
                    <nav aria-label="Site views" className="flex gap-6">
                      <Link
                        to="/sites/$site"
                        params={{ site }}
                        search={{ scope, view: "tasks" }}
                        aria-current={!workspace ? "page" : undefined}
                        className={`border-b-2 py-3 text-sm font-medium ${!workspace ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        Tasks
                      </Link>
                      {canInspect && (
                        <Link
                          to="/sites/$site"
                          params={{ site }}
                          search={{ scope, view: "workspace" }}
                          aria-current={workspace ? "page" : undefined}
                          className={`border-b-2 py-3 text-sm font-medium ${workspace ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        >
                          Workspace
                        </Link>
                      )}
                    </nav>
                    {!workspace && signedIn && (
                      <Select
                        value={scope}
                        onValueChange={(value) => {
                          void navigate({
                            search: { view: "tasks", scope: scopeSchema.parse(value) },
                          });
                        }}
                      >
                        <SelectTrigger
                          aria-label="Task visibility"
                          className="mb-2 min-w-36 bg-card"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" align="end">
                          <SelectItem value="public">Public tasks</SelectItem>
                          <SelectItem value="mine">My tasks</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {workspace ? (
                    <div className="min-h-[28rem] flex-1 overflow-hidden rounded-lg border bg-card">
                      <ScoutWorkspace
                        key={parsed.data}
                        target={{ kind: "site", site: parsed.data }}
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
                    <SiteTaskList key={`${site}:${scope}`} site={parsed.data} scope={scope} />
                  )}
                </div>
              )
            }
          />
        }
      />
    </main>
  );
}

function SiteResearchControl({
  site,
}: {
  site: NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;
}) {
  const refresh = useAction(api.agentsApi.siteResearch.refresh);
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
