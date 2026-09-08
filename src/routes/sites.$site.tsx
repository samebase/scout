import { Link, createFileRoute } from "@tanstack/react-router";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { usePaginatedQuery } from "convex/react";
import { PanelLeftIcon } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { ScoutWorkspace } from "#components/scout-workspace";
import { chatSearchSchema } from "#lib/chat-search";
import { siteWorkspaceSchema } from "../../convex/workspaceModel";

const searchSchema = chatSearchSchema.pick({ file: true, terminal: true });

export const Route = createFileRoute("/sites/$site")({
  staticData: { access: "access_lab" },
  validateSearch: (search) => searchSchema.parse(search),
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
    <SidebarRuntimeProvider controller={{ isHydrated: true, state, setState }}>
      <SiteWorkspaceLayout />
    </SidebarRuntimeProvider>
  );
}

function SiteWorkspaceLayout() {
  const { site } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const parsed = siteWorkspaceSchema.safeParse(site);
  const { setMobilePane } = useSidebarActions();
  const { results, status, loadMore } = usePaginatedQuery(
    api.scout.workspaces.listSites,
    {},
    { initialNumItems: 50 },
  );
  return (
    <main className="h-[calc(100dvh-4rem)] min-h-[28rem]">
      <SidebarLayout
        mobileMinResizeBehavior="min_resize_to_slide"
        resizeHandleLabels={{ left: "Resize sites navigation", right: "Resize workspace" }}
        addressChrome={
          <header className="flex h-12 min-w-0 items-center gap-2 px-2 sm:px-4">
            <SitesToggle />
            <h1 className="min-w-0 truncate text-sm font-semibold" title={site}>
              {site}
            </h1>
          </header>
        }
        left={
          <PaneFrame
            content={
              <nav aria-label="Sites" className="p-2 text-sm">
                {status === "LoadingFirstPage" ? (
                  <p role="status" className="p-2 text-muted-foreground">
                    Loading sites…
                  </p>
                ) : results.length === 0 ? (
                  <p className="p-2 text-muted-foreground">No shared site workspaces yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {results.map((hostname) => (
                      <li key={hostname}>
                        <Link
                          to="/sites/$site"
                          params={{ site: hostname }}
                          search={{}}
                          onClick={() => setMobilePane("main")}
                          className="block break-all rounded-md px-3 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted aria-[current=page]:font-medium"
                        >
                          {hostname}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {status === "CanLoadMore" || status === "LoadingMore" ? (
                  <Button
                    className="mt-2 w-full"
                    variant="ghost"
                    size="sm"
                    disabled={status === "LoadingMore"}
                    onClick={() => loadMore(50)}
                  >
                    {status === "LoadingMore" ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </nav>
            }
          />
        }
        main={
          parsed.success ? (
            <ScoutWorkspace
              key={parsed.data}
              target={{ site: parsed.data }}
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
          ) : (
            <p className="p-4 text-muted-foreground">Site workspace not found.</p>
          )
        }
      />
    </main>
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
      aria-label={shown ? (isMobile ? "Back to workspace" : "Hide sites") : "Show sites"}
      aria-pressed={shown}
      onClick={() => (isMobile ? setMobilePane(shown ? "main" : "left") : toggleLeftPane())}
    >
      <PanelLeftIcon aria-hidden="true" />
    </Button>
  );
}
