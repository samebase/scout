import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { ServiceAccountsSection, type AccountEditor } from "#components/scout-service-accounts";
import { Button } from "#components/ui/button";
import { ScoutAvailability, ScoutCurrentActivity } from "#components/scout-current-activity";
import { canAccess, useViewerAccess } from "#lib/access";

const searchSchema = z.object({
  view: z.literal("add-account").optional().catch(undefined),
  account: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/scouts/$slug")({
  staticData: { access: "access_scout_view" },
  validateSearch: (search) => searchSchema.parse(search),
  component: ScoutDetailPage,
});

function ScoutDetailPage() {
  const viewer = useViewerAccess();
  const canManage =
    viewer?.kind === "account" && canAccess("access_scout_manage", viewer.accessKeys);
  const canStartTask = viewer?.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/scouts/$slug" });
  const scout = useQuery(api.scout.scouts.get, { slug });
  const resources = useQuery(
    api.scout.scouts.resources,
    canManage && scout ? { scoutId: scout._id } : "skip",
  );
  const serviceAccounts = useQuery(
    api.scout.serviceAccounts.list,
    scout ? { scoutId: scout._id } : "skip",
  );

  if (scout === undefined) {
    return (
      <section aria-busy="true" aria-live="polite">
        <p className="text-muted-foreground py-10 text-sm">Loading scout...</p>
      </section>
    );
  }

  if (scout === null) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="scout-not-found-heading">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="rounded-xl border px-4 py-8">
          <h1 id="scout-not-found-heading" className="text-xl font-medium tracking-tight">
            Scout not found
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            No scout matches the slug <code className="font-mono">{slug}</code>.
          </p>
        </div>
      </section>
    );
  }

  const selectedAccount = serviceAccounts?.find((account) => account._id === search.account);
  const editor: AccountEditor =
    search.view === "add-account"
      ? { kind: "create" }
      : selectedAccount
        ? { kind: "update", account: selectedAccount }
        : { kind: "closed" };

  return (
    <>
      <header className="flex flex-col gap-5">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <h1 className="route-heading wrap-break-word">{scout.displayName}</h1>
            <p className="text-muted-foreground mt-1 font-mono text-xs">/{scout.slug}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-start">
            <ScoutAvailability scout={scout} />
            {canStartTask &&
              (scout.status === "active" && scout.availability === "available" ? (
                <Button asChild>
                  <Link to="/agents" search={{ scout: scout._id }}>
                    <PlusIcon aria-hidden="true" />
                    New task
                  </Link>
                </Button>
              ) : (
                <Button type="button" disabled>
                  <PlusIcon aria-hidden="true" />
                  New task
                </Button>
              ))}
          </div>
        </div>
      </header>

      {scout.currentActivity && (
        <section className="surface-panel overflow-hidden" aria-label="Current activity">
          <ScoutCurrentActivity activity={scout.currentActivity} className="" />
        </section>
      )}

      <section aria-labelledby="scout-identity-heading">
        <h2 id="scout-identity-heading" className="text-lg font-semibold tracking-[-0.02em]">
          Identity
        </h2>
        <dl className="surface-panel mt-3 grid gap-5 p-5 text-sm sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">First name</dt>
            <dd className="mt-1 wrap-break-word">{scout.websiteIdentity.firstName}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Last name</dt>
            <dd className="mt-1 wrap-break-word">{scout.websiteIdentity.lastName}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground text-xs">Email</dt>
            <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
          </div>
        </dl>
      </section>

      {resources && (
        <section aria-labelledby="scout-provider-connections-heading">
          <h2
            id="scout-provider-connections-heading"
            className="text-lg font-semibold tracking-[-0.02em]"
          >
            Runtime resources
          </h2>
          <dl className="surface-panel mt-3 grid gap-5 p-5 text-sm sm:grid-cols-2 sm:p-6">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">AgentMail inbox</dt>
              <dd className="mt-1 wrap-break-word font-mono text-xs">
                {resources.agentMail.inboxId}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
              <dd className="mt-1 wrap-break-word">{resources.firecrawl.profileName}</dd>
            </div>
          </dl>
        </section>
      )}

      {canManage && search.account && serviceAccounts !== undefined && !selectedAccount ? (
        <p role="alert">Account not found.</p>
      ) : null}
      <ServiceAccountsSection
        scout={scout}
        accounts={serviceAccounts}
        management={
          canManage
            ? {
                editor,
                onEdit: (next) => {
                  switch (next.kind) {
                    case "closed":
                      void navigate({ search: {} });
                      break;
                    case "create":
                      void navigate({ search: { view: "add-account" } });
                      break;
                    case "update":
                      void navigate({ search: { account: next.account._id } });
                      break;
                  }
                },
              }
            : null
        }
      />
    </>
  );
}
