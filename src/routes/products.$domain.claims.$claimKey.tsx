import { useUIMessages } from "@convex-dev/agent/react";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlayIcon,
  RotateCcwIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ServiceIcon } from "#components/service-icon";
import { ScoutRunMessageView, type ScoutRunMessage } from "#components/scout-run-message";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/products/$domain/claims/$claimKey")({
  head: () => ({ meta: [{ title: "Claim test | Scout" }] }),
  component: ProductClaimPage,
});

type Product = NonNullable<FunctionReturnType<typeof api.products.getByDomain>>;
type ResolvedClaim = NonNullable<FunctionReturnType<typeof api.products.getClaimByDomain>>;
type Claim = ResolvedClaim["claim"];
type ClaimRun = NonNullable<FunctionReturnType<typeof api.claimTests.latest>>;

type StartState = { kind: "idle" } | { kind: "starting" } | { kind: "failed"; message: string };
type ClaimVerdict = "Supported" | "Qualified" | "Refuted" | "Inconclusive";

const CLAIM_RESIZE_HANDLE_LABELS = {
  left: "Resize claim list",
  right: "Resize test activity",
} satisfies SidebarLayoutResizeHandleLabels;

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;

function ProductClaimPage() {
  const { claimKey, domain } = Route.useParams();
  const product = useQuery(api.products.getByDomain, { domain });
  const resolvedClaim = useQuery(api.products.getClaimByDomain, { claimKey, domain });
  const latestRun = useQuery(api.claimTests.latest, { claimKey, domain });
  const liveView = useQuery(api.claimTests.liveView, { claimKey, domain });
  const runMessages = useUIMessages(
    api.scout.lab.listMessages,
    latestRun?.threadId ? { threadId: latestRun.threadId } : "skip",
    { initialNumItems: 50, stream: true },
  );
  const loading = product === undefined || resolvedClaim === undefined;
  const messages = latestRun ? runMessages.results : [];

  return (
    <>
      <SidebarLayout
        addressChrome={<ClaimWorkspaceChrome loading={loading} product={product ?? undefined} />}
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <ClaimNavigation
                domain={domain}
                product={product}
                selectedClaimKey={resolvedClaim?.claim.claimKey}
              />
            }
            header={
              <div className="flex h-full min-w-0 items-center px-3">
                <Link
                  to="/products/$domain"
                  params={{ domain }}
                  className="inline-flex min-w-0 items-center gap-2 text-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Claims</span>
                </Link>
              </div>
            }
            scrollRestorationId={`claim-navigation:${domain}`}
          />
        }
        main={
          <PaneFrame
            content={
              <ClaimMain
                claimKey={claimKey}
                domain={domain}
                latestRun={latestRun}
                liveViewUrl={liveView?.url ?? null}
                loading={loading}
                messages={messages}
                product={product ?? undefined}
                productMissing={product === null}
                resolvedClaim={resolvedClaim ?? undefined}
                claimMissing={resolvedClaim === null}
              />
            }
            scrollRestorationId={`claim-main:${domain}:${claimKey}`}
          />
        }
        right={
          <PaneFrame
            content={
              <ClaimActivityPane
                latestRun={latestRun}
                loadingMessages={
                  latestRun !== null &&
                  latestRun !== undefined &&
                  runMessages.status === "LoadingFirstPage"
                }
                messages={messages}
              />
            }
            header={<ClaimActivityHeader latestRun={latestRun} />}
            scrollRestorationId={`claim-activity:${domain}:${claimKey}`}
          />
        }
        resizeHandleLabels={CLAIM_RESIZE_HANDLE_LABELS}
      />
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: scoutSidebarDesktopPrehydrationScript }}
      />
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: scoutSidebarMobilePrehydrationScript }}
      />
    </>
  );
}

function ClaimWorkspaceChrome({
  loading,
  product,
}: {
  loading: boolean;
  product: Product | undefined;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, mobilePane, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const claimsShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const activityShown = isMobile ? mobilePane === "right" : rightDesktopOpen;

  const toggleClaims = () => {
    if (isMobile) {
      setMobilePane(claimsShown ? "main" : "left");
      return;
    }
    toggleLeftPane();
  };

  const toggleActivity = () => {
    if (isMobile) {
      setMobilePane(activityShown ? "main" : "right");
      return;
    }
    toggleRightPane();
  };

  return (
    <div className="flex h-12 min-w-0 items-center gap-2 px-3 sm:px-4">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={claimsShown ? "Hide claims" : "Show claims"}
        aria-pressed={claimsShown}
        onClick={toggleClaims}
      >
        <PanelLeftIcon />
      </Button>
      {product ? (
        <ServiceIcon
          serviceName={product.name}
          serviceDomain={product.domain}
          className="size-6 shrink-0 rounded-md"
        />
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {loading ? "Loading..." : (product?.name ?? "Claim not found")}
      </h1>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={activityShown ? "Hide test activity" : "Show test activity"}
        aria-pressed={activityShown}
        onClick={toggleActivity}
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
}

function ClaimNavigation({
  domain,
  product,
  selectedClaimKey,
}: {
  domain: string;
  product: Product | null | undefined;
  selectedClaimKey: string | undefined;
}) {
  const { setMobilePane } = useSidebarActions();

  if (product === undefined) {
    return (
      <p className="text-muted-foreground px-3 py-8 text-center text-sm" role="status">
        Loading...
      </p>
    );
  }

  if (product === null) {
    return <ClaimNavigationEmptyState title="Product not found" />;
  }

  const investigation = product.latestCompletedInvestigation;
  if (investigation === null) {
    return <ClaimNavigationEmptyState title="No investigation" />;
  }

  const claims = investigation.result.claims;
  if (claims.length === 0) {
    return <ClaimNavigationEmptyState title="No claims" />;
  }

  return (
    <nav className="p-2.5" aria-label="Product claims">
      <ol className="space-y-1">
        {claims.map((claim) => {
          const selected = claim.claimKey === selectedClaimKey;
          return (
            <li key={claim.claimKey}>
              <Link
                to="/products/$domain/claims/$claimKey"
                params={{ claimKey: claim.claimKey, domain }}
                className="group block rounded-[0.625rem] border border-transparent px-3 py-3 outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[selected]:border-primary/15 data-[selected]:bg-sidebar-accent data-[selected]:text-sidebar-accent-foreground"
                data-selected={selected ? "" : undefined}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMobilePane("main")}
              >
                <span className="text-muted-foreground font-mono text-[0.625rem] font-medium">
                  {claim.category}
                </span>
                <span className="mt-1.5 block wrap-break-word text-sm font-medium leading-5">
                  {claim.claim}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ClaimNavigationEmptyState({ title }: { title: string }) {
  return <p className="text-muted-foreground px-3 py-8 text-center text-sm">{title}</p>;
}

function ClaimMain({
  claimKey,
  claimMissing,
  domain,
  latestRun,
  liveViewUrl,
  loading,
  messages,
  product,
  productMissing,
  resolvedClaim,
}: {
  claimKey: string;
  claimMissing: boolean;
  domain: string;
  latestRun: ClaimRun | null | undefined;
  liveViewUrl: string | null;
  loading: boolean;
  messages: readonly ScoutRunMessage[];
  product: Product | undefined;
  productMissing: boolean;
  resolvedClaim: ResolvedClaim | undefined;
}) {
  if (loading) {
    return <CenteredStatus>Loading...</CenteredStatus>;
  }

  if (productMissing || product === undefined) {
    return <ClaimRouteEmptyState title="Product not found" />;
  }

  if (product.latestCompletedInvestigation === null) {
    return <ClaimRouteEmptyState domain={domain} title="Investigate this product first" />;
  }

  if (product.latestCompletedInvestigation.result.claims.length === 0) {
    return <ClaimRouteEmptyState domain={domain} title="No claims found" />;
  }

  if (claimMissing || resolvedClaim === undefined) {
    return <ClaimRouteEmptyState domain={domain} title="Claim not found" />;
  }

  const claim = resolvedClaim.claim;

  return (
    <main className="mx-auto w-full max-w-5xl p-4 @md:p-7 @xl:p-10">
      <article>
        <header className="max-w-4xl">
          <span className="text-muted-foreground font-mono text-xs font-medium">
            {claim.category}
          </span>
          <h2 className="mt-3 max-w-3xl wrap-break-word text-2xl font-semibold tracking-[-0.04em] @md:text-3xl @xl:text-4xl">
            {claim.claim}
          </h2>
          <a
            href={claim.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground mt-3 inline-flex max-w-full items-center gap-1.5 text-xs underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="truncate">{claim.pageTitle || "Source"}</span>
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </header>

        {claim.evidenceExcerpt ? (
          <blockquote className="mt-6 max-w-3xl rounded-[0.75rem] bg-muted/55 px-4 py-3 text-sm leading-6 text-muted-foreground">
            {claim.evidenceExcerpt}
          </blockquote>
        ) : null}

        {claim.support || claim.qualifiers.length > 0 ? (
          <details className="mt-5 max-w-3xl text-sm">
            <summary className="text-muted-foreground cursor-pointer select-none outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              Research notes
            </summary>
            <div className="mt-3 space-y-3 border-l pl-4 leading-6">
              {claim.support ? <p>{claim.support}</p> : null}
              {claim.qualifiers.length > 0 ? (
                <ul className="list-disc space-y-1 pl-4">
                  {claim.qualifiers.map((qualifier, index) => (
                    <li key={`${index}:${qualifier}`}>{qualifier}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}

        <ClaimTest
          claim={claim}
          claimKey={claimKey}
          domain={domain}
          latestRun={latestRun}
          liveViewUrl={liveViewUrl}
          messages={messages}
        />
      </article>
    </main>
  );
}

function ClaimTest({
  claim,
  claimKey,
  domain,
  latestRun,
  liveViewUrl,
  messages,
}: {
  claim: Claim;
  claimKey: string;
  domain: string;
  latestRun: ClaimRun | null | undefined;
  liveViewUrl: string | null;
  messages: readonly ScoutRunMessage[];
}) {
  const startClaimTest = useMutation(api.claimTests.start);
  const [startState, setStartState] = useState<StartState>({ kind: "idle" });
  const running = latestRun?.generation.status === "pending";
  const resultText = latestAssistantText(messages);

  const start = async () => {
    setStartState({ kind: "starting" });
    try {
      await startClaimTest({ claimKey, domain });
      setStartState({ kind: "idle" });
    } catch (error) {
      setStartState({ kind: "failed", message: claimTestError(error) });
    }
  };

  return (
    <section className="mt-9 border-t pt-7" aria-labelledby="claim-test-heading">
      <h3 id="claim-test-heading" className="text-xl font-semibold tracking-[-0.025em]">
        Test this claim
      </h3>
      <p className="mt-3 max-w-3xl wrap-break-word text-sm leading-6">
        {claim.suggestedMysteryShop}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void start()}
          disabled={running || startState.kind === "starting" || latestRun === undefined}
        >
          {running || startState.kind === "starting" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : latestRun ? (
            <RotateCcwIcon />
          ) : (
            <PlayIcon />
          )}
          {running || startState.kind === "starting"
            ? "Testing"
            : latestRun
              ? "Test again"
              : "Test claim"}
        </Button>
        <span className="text-muted-foreground text-xs" aria-live="polite">
          {runStatus(latestRun)}
        </span>
      </div>
      {startState.kind === "failed" ? (
        <p className="text-destructive mt-3 flex items-start gap-2 text-sm" role="alert">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {startState.message}
        </p>
      ) : null}
      <ClaimRunResult latestRun={latestRun} liveViewUrl={liveViewUrl} resultText={resultText} />
    </section>
  );
}

function ClaimRunResult({
  latestRun,
  liveViewUrl,
  resultText,
}: {
  latestRun: ClaimRun | null | undefined;
  liveViewUrl: string | null;
  resultText: string | null;
}) {
  if (!latestRun) return null;

  if (latestRun.generation.status === "pending" && !resultText) {
    if (liveViewUrl) {
      return <ClaimLiveBrowser url={liveViewUrl} />;
    }

    return (
      <div className="mt-8 border-t pt-6" role="status">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LoaderCircleIcon className="size-4 animate-spin text-primary" />
          Scout is testing the claim
        </p>
      </div>
    );
  }

  if (latestRun.generation.status === "failed") {
    return (
      <div className="mt-8 border-t pt-6">
        <p className="text-destructive text-sm font-medium">Test failed</p>
        <p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm leading-6">
          {latestRun.generation.failure}
        </p>
        <RunMetadata run={latestRun} />
      </div>
    );
  }

  const result = resultText ? parseClaimResult(resultText) : null;
  const liveBrowser =
    latestRun.generation.status === "pending" && liveViewUrl ? (
      <ClaimLiveBrowser url={liveViewUrl} />
    ) : null;

  return (
    <>
      {liveBrowser}
      <div className="mt-8 border-t pt-6">
        {latestRun.generation.status === "pending" ? (
          <h3 className="text-sm font-medium">Live result</h3>
        ) : result?.verdict ? (
          <p className="flex items-center gap-2 text-sm font-medium">
            <span
              className={`size-2 rounded-full ${verdictDotClass(result.verdict)}`}
              aria-hidden="true"
            />
            {result.verdict}
          </p>
        ) : (
          <h3 className="text-sm font-medium">Result</h3>
        )}
        {result?.details ? (
          latestRun.generation.status === "completed" && result.verdict ? (
            <details className="mt-4 max-w-3xl text-sm">
              <summary className="text-muted-foreground cursor-pointer select-none outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                Evidence and observations
              </summary>
              <div className="mt-4 border-l pl-4 whitespace-pre-wrap leading-6">
                {result.details}
              </div>
            </details>
          ) : (
            <div className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6">
              {result.details}
            </div>
          )
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">No written result.</p>
        )}
        <RunMetadata run={latestRun} />
      </div>
    </>
  );
}

function ClaimLiveBrowser({ url }: { url: string }) {
  return (
    <section
      className="surface-panel mt-8 overflow-hidden"
      aria-labelledby="claim-live-browser-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2.5 @md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <h3 id="claim-live-browser-heading" className="truncate text-sm font-semibold">
            Firecrawl browser
          </h3>
          <span className="text-muted-foreground text-xs" role="status">
            Live
          </span>
        </div>
        <Button asChild size="xs" variant="outline">
          <a href={url} target="_blank" rel="noreferrer">
            Open
            <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
          </a>
        </Button>
      </div>
      <iframe
        src={url}
        title="Live Scout browser"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        className="block h-64 w-full bg-background @md:h-80 @xl:h-[30rem]"
      />
    </section>
  );
}

function RunMetadata({ run }: { run: ClaimRun }) {
  const generation = run.generation;
  if (generation.status === "pending") return null;
  const duration =
    generation.status === "completed"
      ? generation.completedAt - generation.startedAt
      : generation.failedAt - generation.startedAt;
  const parts = [`${(duration / 1000).toFixed(1)} s`, run.scout.displayName];
  if (generation.firecrawlCredits !== null) {
    parts.push(`${generation.firecrawlCredits} Firecrawl credits`);
  }
  return <p className="text-muted-foreground mt-4 text-xs">{parts.join(", ")}</p>;
}

function ClaimRouteEmptyState({ domain, title }: { domain?: string; title: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl p-4 @md:p-6">
      <div className="surface-panel border-dashed px-5 py-16 text-center">
        <p className="text-sm font-medium">{title}</p>
        <Button asChild size="sm" variant="outline" className="mt-4">
          {domain ? (
            <Link to="/products/$domain" params={{ domain }}>
              Open product
            </Link>
          ) : (
            <Link to="/products">Open products</Link>
          )}
        </Button>
      </div>
    </main>
  );
}

function CenteredStatus({ children }: { children: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl p-4 @md:p-6">
      <p className="text-muted-foreground py-16 text-center text-sm" role="status">
        {children}
      </p>
    </main>
  );
}

function ClaimActivityHeader({ latestRun }: { latestRun: ClaimRun | null | undefined }) {
  return (
    <div className="flex h-full min-w-0 items-center justify-between gap-3 px-3">
      <span className="truncate text-sm font-semibold">Test activity</span>
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {runStatus(latestRun)}
      </span>
    </div>
  );
}

function ClaimActivityPane({
  latestRun,
  loadingMessages,
  messages,
}: {
  latestRun: ClaimRun | null | undefined;
  loadingMessages: boolean;
  messages: readonly ScoutRunMessage[];
}) {
  if (latestRun === undefined || loadingMessages) {
    return (
      <p className="text-muted-foreground p-4 text-sm" role="status">
        Loading...
      </p>
    );
  }

  if (latestRun === null) {
    return <aside aria-label="Test activity" />;
  }

  const activityMessages = messages.filter((message) => message.role !== "user");

  return (
    <aside className="space-y-4 p-3 @md:p-4" aria-label="Test activity">
      {activityMessages.length > 0 ? (
        activityMessages.map((message) => (
          <ScoutRunMessageView key={message.key} message={message} showText={false} />
        ))
      ) : (
        <p className="text-muted-foreground text-sm" role="status">
          Starting Scout...
        </p>
      )}
      <Button asChild size="sm" variant="ghost" className="w-full">
        <Link to="/lab" search={{ experiment: latestRun.experimentId, thread: latestRun.threadId }}>
          <TerminalSquareIcon />
          Open raw run
        </Link>
      </Button>
    </aside>
  );
}

function latestAssistantText(messages: readonly ScoutRunMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.text.trim()) return message.text.trim();
  }
  return null;
}

function parseClaimResult(text: string) {
  const match = text.match(/^\s*\**Verdict:\s*(Supported|Qualified|Refuted|Inconclusive)\**\s*/i);
  const verdict = match ? canonicalVerdict(match[1]) : null;
  const details = (match ? text.slice(match[0].length) : text)
    .replace(/^#{1,6}\s+/gm, "")
    .replaceAll("**", "")
    .trim();
  return { verdict, details };
}

function canonicalVerdict(value: string | undefined): ClaimVerdict | null {
  const normalized = value?.toLowerCase();
  if (normalized === "supported") return "Supported";
  if (normalized === "qualified") return "Qualified";
  if (normalized === "refuted") return "Refuted";
  if (normalized === "inconclusive") return "Inconclusive";
  return null;
}

function verdictDotClass(verdict: ClaimVerdict) {
  switch (verdict) {
    case "Supported":
      return "bg-emerald-500";
    case "Qualified":
      return "bg-amber-500";
    case "Refuted":
      return "bg-red-500";
    case "Inconclusive":
      return "bg-slate-400";
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

function runStatus(run: ClaimRun | null | undefined) {
  if (run === undefined) return "Loading";
  if (run === null) return "Not tested";
  switch (run.generation.status) {
    case "pending":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default: {
      const _exhaustive: never = run.generation;
      return _exhaustive;
    }
  }
}

function claimTestError(error: unknown) {
  if (!(error instanceof Error)) return "Could not start the test.";
  const message = error.message;
  const known = [
    "Active Scout not found",
    "Scout is already working",
    "Claim not found",
    "Product not found",
  ].find((candidate) => message.includes(candidate));
  return known ?? "Could not start the test.";
}
