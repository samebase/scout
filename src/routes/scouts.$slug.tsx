import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { ServiceAccountsSection } from "#components/scout-service-accounts";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/scouts/$slug")({
  component: ScoutDetailPage,
});

type RegistrationState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

function ScoutDetailPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const createThread = useMutation(api.scout.chats.createThread);
  const [chatState, setChatState] = useState<RegistrationState>({ kind: "idle" });
  const scout = useQuery(api.scout.scouts.get, { slug });
  const serviceAccounts = useQuery(
    api.scout.serviceAccounts.list,
    scout === undefined || scout === null ? "skip" : { scoutId: scout._id },
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

  const statusLabel = scout.status === "active" ? "Active" : "Disabled";
  const statusDotClass = scout.status === "active" ? "bg-emerald-500" : "bg-muted-foreground";
  const startChat = async () => {
    if (scout.status !== "active" || chatState.kind === "submitting") return;
    setChatState({ kind: "submitting" });
    try {
      const created = await createThread({ scoutId: scout._id });
      await navigate({ to: "/chats", search: { thread: created.threadId } });
    } catch {
      setChatState({ kind: "failed", message: "Could not start the chat. Try again." });
    }
  };

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
            <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
              Worker models act as {scout.displayName} using this identity and the resources below.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-start">
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              <span className={`size-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
              {statusLabel}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={scout.status !== "active" || chatState.kind === "submitting"}
              onClick={() => void startChat()}
            >
              {chatState.kind === "submitting" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <PlusIcon />
              )}
              {chatState.kind === "submitting" ? "Starting" : "New chat"}
            </Button>
          </div>
        </div>
        {chatState.kind === "failed" ? (
          <p className="text-destructive text-sm" role="alert">
            {chatState.message}
          </p>
        ) : null}
      </header>

      <section aria-labelledby="scout-identity-heading">
        <h2 id="scout-identity-heading" className="text-lg font-semibold tracking-[-0.02em]">
          Identity
        </h2>
        <dl className="surface-panel mt-3 grid gap-5 p-5 text-sm sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">First name</dt>
            <dd className="mt-1 wrap-break-word">
              {scout.websiteIdentity?.firstName ?? "Not configured"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Last name</dt>
            <dd className="mt-1 wrap-break-word">
              {scout.websiteIdentity?.lastName ?? "Not configured"}
            </dd>
          </div>
        </dl>
      </section>

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
            <dd className="mt-1 wrap-break-word font-mono text-xs">{scout.agentMail.inboxId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">AgentMail address</dt>
            <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
            <dd className="mt-1 wrap-break-word">{scout.firecrawl.profileName}</dd>
          </div>
        </dl>
      </section>

      <ServiceAccountsSection scout={scout} accounts={serviceAccounts} />
    </>
  );
}
