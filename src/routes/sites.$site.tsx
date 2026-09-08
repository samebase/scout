import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
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
  const { site } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const parsed = siteWorkspaceSchema.safeParse(site);
  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] min-h-[28rem] w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex shrink-0 items-center gap-3">
        <Link
          to="/sites"
          aria-label="Back to sites"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
        </Link>
        <h1 className="min-w-0 break-all text-xl font-semibold tracking-tight">{site}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {parsed.success ? (
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
        )}
      </div>
    </main>
  );
}
