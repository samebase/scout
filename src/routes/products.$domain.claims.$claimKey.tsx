import { useUIMessages } from "@convex-dev/agent/react";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type HlsType from "hls.js";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ServiceIcon } from "#components/service-icon";
import { ScoutRunMessageView, type ScoutRunMessage } from "#components/scout-run-message";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Textarea } from "#components/ui/textarea";
import {
  activeClickAt,
  activePageIdAt,
  activeTabAt,
  buildReplayTimeline,
} from "#lib/claimReplayTimeline";

export const Route = createFileRoute("/products/$domain/claims/$claimKey")({
  head: () => ({ meta: [{ title: "Claim test | Scout" }] }),
  component: ProductClaimPage,
});

type Product = NonNullable<FunctionReturnType<typeof api.products.getByDomain>>;
type ResolvedClaim = NonNullable<FunctionReturnType<typeof api.products.getClaimByDomain>>;
type Claim = ResolvedClaim["claim"];
type ClaimRun = NonNullable<FunctionReturnType<typeof api.claimTests.latest>>;
type ReplayPagesResult = FunctionReturnType<typeof api.claimTestReplay.listPages>;
type ReplayReady = Extract<ReplayPagesResult, { status: "ready" }>;

type StartState = { kind: "idle" } | { kind: "starting" } | { kind: "failed"; message: string };
type ClaimEditFields = {
  claim: string;
  sourceUrl: string;
  suggestedMysteryShop: string;
};
type ClaimEditState =
  | { kind: "closed" }
  | { kind: "editing"; fields: ClaimEditFields; error: string | null }
  | { kind: "saving"; fields: ClaimEditFields };
type ClaimVerdict = "Supported" | "Qualified" | "Refuted" | "Inconclusive";

const CLAIM_RESIZE_HANDLE_LABELS = {
  left: "Resize claim list",
  right: "Resize test activity",
} satisfies SidebarLayoutResizeHandleLabels;
const REPLAY_PREPARATION_RETRIES = 10;
const REPLAY_RETRY_DELAY_MS = 2_000;

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
                key={claimKey}
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
  const [editing, setEditing] = useState(false);

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
        <ClaimHeader
          key={claim.claimKey}
          claim={claim}
          claimKey={claimKey}
          domain={domain}
          onEditingChange={setEditing}
          testRunning={latestRun?.generation.status === "pending"}
        />

        {editing ? null : (
          <>
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
          </>
        )}
      </article>
    </main>
  );
}

function ClaimHeader({
  claim,
  claimKey,
  domain,
  onEditingChange,
  testRunning,
}: {
  claim: Claim;
  claimKey: string;
  domain: string;
  onEditingChange: (editing: boolean) => void;
  testRunning: boolean;
}) {
  const updateClaim = useMutation(api.products.updateClaim);
  const [state, setState] = useState<ClaimEditState>({ kind: "closed" });

  const open = () => {
    onEditingChange(true);
    setState({
      kind: "editing",
      fields: {
        claim: claim.claim,
        sourceUrl: claim.sourceUrl,
        suggestedMysteryShop: claim.suggestedMysteryShop,
      },
      error: null,
    });
  };

  const change = <Key extends keyof ClaimEditFields>(key: Key, value: ClaimEditFields[Key]) => {
    setState((current) =>
      current.kind === "editing"
        ? {
            kind: "editing",
            fields: { ...current.fields, [key]: value },
            error: null,
          }
        : current,
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "editing") return;
    const error = validateClaimEdit(state.fields, domain);
    if (error) {
      setState({ ...state, error });
      return;
    }
    const fields = {
      claim: state.fields.claim.trim(),
      sourceUrl: state.fields.sourceUrl.trim(),
      suggestedMysteryShop: state.fields.suggestedMysteryShop.trim(),
    };
    setState({ kind: "saving", fields });
    try {
      await updateClaim({ claimKey, domain, ...fields });
      setState({ kind: "closed" });
      onEditingChange(false);
    } catch (error) {
      setState({ kind: "editing", fields, error: claimUpdateError(error) });
    }
  };

  if (state.kind !== "closed") {
    const saving = state.kind === "saving";
    const error = state.kind === "editing" ? state.error : null;
    return (
      <form className="max-w-3xl" onSubmit={(event) => void submit(event)}>
        <h2 className="text-xl font-semibold tracking-[-0.025em]">Edit claim</h2>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">
            Claim
            <Textarea
              name="claim"
              value={state.fields.claim}
              onChange={(event) => change("claim", event.target.value)}
              disabled={saving}
              maxLength={1_200}
              rows={4}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Starting URL
            <Input
              name="sourceUrl"
              type="url"
              value={state.fields.sourceUrl}
              onChange={(event) => change("sourceUrl", event.target.value)}
              disabled={saving}
              maxLength={2_048}
              required
            />
            <span className="text-muted-foreground text-xs font-normal">
              Scout opens this page first.
            </span>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Test instructions
            <Textarea
              name="suggestedMysteryShop"
              value={state.fields.suggestedMysteryShop}
              onChange={(event) => change("suggestedMysteryShop", event.target.value)}
              disabled={saving}
              maxLength={1_200}
              rows={5}
              required
            />
          </label>
        </div>
        {error ? (
          <p className="text-destructive mt-4 flex items-start gap-2 text-sm" role="alert">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            {saving ? "Saving" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setState({ kind: "closed" });
              onEditingChange(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <header className="max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-muted-foreground font-mono text-xs font-medium">
            {claim.category}
          </span>
          {claim.isEdited ? <span className="text-muted-foreground text-xs">Edited</span> : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={open}
          disabled={testRunning}
          title={testRunning ? "Wait for the current test to finish" : undefined}
        >
          <PencilIcon />
          Edit
        </Button>
      </div>
      <h2 className="mt-3 max-w-3xl wrap-break-word text-2xl font-semibold tracking-[-0.04em] @md:text-3xl @xl:text-4xl">
        {claim.claim}
      </h2>
      <a
        href={claim.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground mt-3 inline-flex max-w-full items-center gap-1.5 text-xs underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate">{claim.pageTitle || "Starting page"}</span>
        <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
      </a>
    </header>
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
      <>
        <PreviousClaimRunNotice run={latestRun} />
        <ClaimReplay runId={latestRun.runId} />
        <div className="mt-8 border-t pt-6">
          <p className="text-destructive text-sm font-medium">Test failed</p>
          <p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm leading-6">
            {latestRun.generation.failure}
          </p>
          <RunMetadata run={latestRun} />
        </div>
      </>
    );
  }

  const result = resultText ? parseClaimResult(resultText) : null;
  const liveBrowser =
    latestRun.generation.status === "pending" && liveViewUrl ? (
      <ClaimLiveBrowser url={liveViewUrl} />
    ) : null;

  return (
    <>
      <PreviousClaimRunNotice run={latestRun} />
      {liveBrowser ??
        (latestRun.generation.status === "completed" ? (
          <ClaimReplay runId={latestRun.runId} />
        ) : null)}
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

function PreviousClaimRunNotice({ run }: { run: ClaimRun }) {
  if (run.matchesCurrentClaim) return null;
  return (
    <section className="mt-8 border-t pt-6" aria-labelledby="previous-claim-run-heading">
      <h3 id="previous-claim-run-heading" className="text-sm font-semibold">
        Needs retest
      </h3>
      <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
        This run used earlier claim wording. Its replay and result remain available below.
      </p>
      {run.testedClaim ? (
        <details className="mt-3 max-w-3xl text-sm">
          <summary className="text-muted-foreground cursor-pointer select-none outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            What this run tested
          </summary>
          <div className="mt-3 space-y-3 border-l pl-4 leading-6">
            <p className="font-medium">{run.testedClaim.claim}</p>
            <p>{run.testedClaim.suggestedMysteryShop}</p>
            <a
              href={run.testedClaim.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground inline-flex max-w-full items-center gap-1.5 text-xs underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate">{run.testedClaim.sourceUrl}</span>
              <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </details>
      ) : null}
    </section>
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

type ReplayLoadState =
  | { kind: "loading" | "processing" }
  | { kind: "ready"; replay: ReplayReady }
  | { kind: "unavailable" | "delayed" | "failed" };

function ClaimReplay({ runId }: { runId: ClaimRun["runId"] }) {
  const listPages = useAction(api.claimTestReplay.listPages);
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ReplayLoadState>({ kind: "loading" });
  const refresh = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    setState({ kind: "loading" });

    const load = async () => {
      try {
        const replay = await listPages({ runId });
        if (cancelled) return;
        if (replay.status === "ready") {
          if (replay.pages.length === 0) {
            setState({ kind: "delayed" });
            return;
          }
          setState({ kind: "ready", replay });
          return;
        }
        if (replay.status === "unavailable") {
          setState({ kind: "unavailable" });
          return;
        }
        attempt += 1;
        if (attempt >= REPLAY_PREPARATION_RETRIES) {
          setState({ kind: "delayed" });
          return;
        }
        setState({ kind: "processing" });
        retryTimer = window.setTimeout(() => void load(), REPLAY_RETRY_DELAY_MS);
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [listPages, requestVersion, runId]);

  return (
    <section className="surface-panel mt-8 overflow-hidden" aria-labelledby="claim-replay-heading">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2.5 @md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <PlayIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <h3 id="claim-replay-heading" className="truncate text-sm font-semibold">
            Firecrawl replay
          </h3>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={refresh}>
          <RotateCcwIcon />
          Refresh
        </Button>
      </div>
      {state.kind === "ready" ? (
        <ClaimReplayPlayer replay={state.replay} requestVersion={requestVersion} runId={runId} />
      ) : (
        <ReplayStatus state={state.kind} onRetry={refresh} />
      )}
    </section>
  );
}

function ReplayStatus({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: Exclude<ReplayLoadState["kind"], "ready">;
}) {
  const waiting = state === "loading" || state === "processing";
  const message = waiting
    ? "Preparing replay"
    : state === "unavailable"
      ? "This run has no saved replay."
      : state === "delayed"
        ? "The replay is taking longer than expected."
        : "Could not load the replay.";
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        {waiting ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
        {message}
      </p>
      {!waiting && state !== "unavailable" ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcwIcon />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

type ReplayPlaylistsState =
  | { kind: "loading" }
  | { kind: "ready"; playlists: Map<string, string>; failedPageIds: string[] }
  | { kind: "failed" };

function ClaimReplayPlayer({
  replay,
  requestVersion,
  runId,
}: {
  replay: ReplayReady;
  requestVersion: number;
  runId: ClaimRun["runId"];
}) {
  const loadPlaylist = useAction(api.claimTestReplay.loadPlaylist);
  const [playlistState, setPlaylistState] = useState<ReplayPlaylistsState>({ kind: "loading" });
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const currentTimeRef = useRef(0);
  const playbackAnchorRef = useRef({ currentTimeMs: 0, performanceMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [manualPageId, setManualPageId] = useState<string | null>(null);
  const [mediaAspectRatios, setMediaAspectRatios] = useState<Record<string, number>>({});
  const [failedMediaPageIds, setFailedMediaPageIds] = useState<string[]>([]);
  const timeline = useMemo(
    () => buildReplayTimeline(replay.pages, replay.operations),
    [replay.operations, replay.pages],
  );

  useEffect(() => {
    let cancelled = false;
    setPlaylistState({ kind: "loading" });

    void Promise.all(
      timeline.pages.map(async (page) => {
        for (let attempt = 0; attempt < REPLAY_PREPARATION_RETRIES; attempt += 1) {
          try {
            const result = await loadPlaylist({ runId, pageId: page.pageId });
            if (result.status === "ready") {
              return [page.pageId, result.playlist] as const;
            }
            if (result.status === "unavailable") return null;
          } catch {
            return null;
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, REPLAY_RETRY_DELAY_MS));
        }
        return null;
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const successful = loaded.filter(
        (entry): entry is readonly [string, string] => entry !== null,
      );
      if (successful.length === 0) {
        setPlaylistState({ kind: "failed" });
        return;
      }
      const playlists = new Map(successful);
      setPlaylistState({
        kind: "ready",
        playlists,
        failedPageIds: timeline.pages
          .filter((page) => !playlists.has(page.pageId))
          .map((page) => page.pageId),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadPlaylist, requestVersion, runId, timeline.pages]);

  useEffect(() => {
    currentTimeRef.current = 0;
    setCurrentTimeMs(0);
    setPlaying(false);
    setManualPageId(null);
    setFailedMediaPageIds([]);
  }, [runId, requestVersion]);

  const reportMediaFailure = useCallback((pageId: string) => {
    setFailedMediaPageIds((current) => (current.includes(pageId) ? current : [...current, pageId]));
  }, []);

  useEffect(() => {
    if (!playing) return;
    playbackAnchorRef.current = {
      currentTimeMs: currentTimeRef.current,
      performanceMs: performance.now(),
    };
    let frame = 0;
    let lastRender = 0;
    const tick = (now: number) => {
      const next = Math.min(
        timeline.durationMs,
        playbackAnchorRef.current.currentTimeMs + (now - playbackAnchorRef.current.performanceMs),
      );
      currentTimeRef.current = next;
      if (now - lastRender >= 50 || next === timeline.durationMs) {
        lastRender = now;
        setCurrentTimeMs(next);
      }
      if (next >= timeline.durationMs) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, timeline.durationMs]);

  const seek = (nextTimeMs: number) => {
    const bounded = Math.min(Math.max(0, nextTimeMs), timeline.durationMs);
    currentTimeRef.current = bounded;
    setCurrentTimeMs(bounded);
    if (playing) {
      playbackAnchorRef.current = { currentTimeMs: bounded, performanceMs: performance.now() };
    }
  };

  const activeTabId = activeTabAt(timeline.points, currentTimeMs);
  const automaticPageId = activePageIdAt(timeline, currentTimeMs);
  const activePageId = manualPageId ?? automaticPageId;
  const activePage = timeline.pages.find((page) => page.pageId === activePageId) ?? null;
  const pointer = activeClickAt(timeline.events, activeTabId, currentTimeMs);
  const viewportAspectRatio = replay.viewport.width / replay.viewport.height;
  const activeMediaAspectRatio = activePageId ? mediaAspectRatios[activePageId] : undefined;
  const pointerIsAccurate =
    pointer !== null &&
    activeMediaAspectRatio !== undefined &&
    Math.abs(activeMediaAspectRatio - viewportAspectRatio) / viewportAspectRatio < 0.02;

  const togglePlayback = () => {
    if (currentTimeRef.current >= timeline.durationMs) seek(0);
    setManualPageId(null);
    setPlaying((current) => !current);
  };

  if (playlistState.kind !== "ready") {
    return (
      <div
        className="flex items-center justify-center bg-neutral-950 px-4 text-center"
        style={{ aspectRatio: `${replay.viewport.width} / ${replay.viewport.height}` }}
      >
        <p className="flex items-center gap-2 text-sm text-neutral-300" role="status">
          {playlistState.kind === "loading" ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {playlistState.kind === "loading"
            ? `Loading ${timeline.pages.length} recorded ${timeline.pages.length === 1 ? "tab" : "tabs"}`
            : "The recorded tabs could not be loaded."}
        </p>
      </div>
    );
  }

  const failedPageIds = new Set([...playlistState.failedPageIds, ...failedMediaPageIds]);
  const activeTrackFailed = activePageId !== null && failedPageIds.has(activePageId);
  const unmatchedPageCount = timeline.pages.filter(
    (page) => page.binding.kind !== "correlated",
  ).length;

  return (
    <div className="min-w-0">
      <div
        className="relative isolate overflow-hidden bg-neutral-950"
        style={{ aspectRatio: `${replay.viewport.width} / ${replay.viewport.height}` }}
      >
        {timeline.pages.map((page) => {
          const playlist = playlistState.playlists.get(page.pageId);
          if (!playlist) return null;
          return (
            <ClaimReplayTrack
              key={page.pageId}
              active={page.pageId === activePageId}
              localTimeSeconds={Math.max(0, currentTimeMs - page.relativeStartMs) / 1_000}
              onAspectRatio={(ratio) =>
                setMediaAspectRatios((current) =>
                  current[page.pageId] === ratio ? current : { ...current, [page.pageId]: ratio },
                )
              }
              onFailure={reportMediaFailure}
              pageId={page.pageId}
              playing={playing}
              playlist={playlist}
            />
          );
        })}
        {activeTrackFailed ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            This recording could not be played. Choose another track or refresh the replay.
          </div>
        ) : activePageId === null ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 px-8 text-center text-sm text-neutral-300">
            A tab change was recorded, but Firecrawl did not expose enough identity data to match it
            to one video track.
          </div>
        ) : null}
        {pointerIsAccurate && pointer ? (
          <span
            className="pointer-events-none absolute z-20 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/50 shadow-[0_0_0_4px_rgba(0,0,0,0.35)] motion-safe:animate-ping"
            style={{
              left: `${((pointer.box.x + pointer.box.width / 2) / replay.viewport.width) * 100}%`,
              top: `${((pointer.box.y + pointer.box.height / 2) / replay.viewport.height) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="border-t bg-background px-3 py-3 @md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={playing ? "Pause replay" : "Play replay"}
            onClick={togglePlayback}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <span className="text-muted-foreground w-20 shrink-0 font-mono text-[11px] tabular-nums">
            {formatReplayTime(currentTimeMs)} / {formatReplayTime(timeline.durationMs)}
          </span>
          <div className="relative min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={Math.max(1, timeline.durationMs)}
              step={50}
              value={currentTimeMs}
              onChange={(event) => {
                setManualPageId(null);
                seek(Number(event.currentTarget.value));
              }}
              aria-label="Replay position"
              className="accent-primary block h-5 w-full cursor-pointer"
            />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0" aria-hidden="true">
              {timeline.transitions.map((transition) => (
                <span
                  key={`${transition.sequence}-${transition.fromTabId}-${transition.toTabId}`}
                  className="absolute top-[-6px] h-3 min-w-px bg-foreground/60"
                  style={{
                    left: `${(transition.earliestTimeMs / Math.max(1, timeline.durationMs)) * 100}%`,
                    width: `${Math.max(
                      0.15,
                      ((transition.latestTimeMs - transition.earliestTimeMs) /
                        Math.max(1, timeline.durationMs)) *
                        100,
                    )}%`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
          {timeline.pages.map((page, index) => (
            <button
              key={page.pageId}
              type="button"
              onClick={() => {
                setPlaying(false);
                setManualPageId(page.pageId);
                if (currentTimeMs < page.relativeStartMs || currentTimeMs > page.relativeEndMs) {
                  seek(page.relativeStartMs);
                }
              }}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                page.pageId === activePageId
                  ? "border-foreground/30 bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={page.pageId === activePageId}
            >
              {replayPageLabel(page, index)}
            </button>
          ))}
        </div>

        <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <span className="truncate">
            {activePage
              ? replayPageLabel(activePage, timeline.pages.indexOf(activePage))
              : "Unmatched tab"}
          </span>
          <span>
            {timeline.events.length} {timeline.events.length === 1 ? "action" : "actions"},{" "}
            {timeline.pages.length} recorded {timeline.pages.length === 1 ? "tab" : "tabs"}
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-[11px] leading-4">
          {timeline.hasIntegrityGap ? "The operation log contains an evidence gap. " : ""}
          {unmatchedPageCount > 0
            ? `${unmatchedPageCount} ${unmatchedPageCount === 1 ? "recording is" : "recordings are"} unmatched and ${unmatchedPageCount === 1 ? "remains" : "remain"} available for manual inspection. `
            : ""}
          {timeline.transitions.length > 0
            ? `${timeline.transitions.length} ${timeline.transitions.length === 1 ? "tab change is" : "tab changes are"} shown at the first confirming sample; each marker spans the interval in which the change occurred. `
            : "No tab change was observed. "}
          Tracks match automatically only when one URL and its start time identify one recorded tab.
          {failedPageIds.size > 0
            ? ` ${failedPageIds.size} ${failedPageIds.size === 1 ? "recording could" : "recordings could"} not be loaded.`
            : ""}
        </p>
      </div>
    </div>
  );
}

function ClaimReplayTrack({
  active,
  localTimeSeconds,
  onAspectRatio,
  onFailure,
  pageId,
  playing,
  playlist,
}: {
  active: boolean;
  localTimeSeconds: number;
  onAspectRatio: (ratio: number) => void;
  onFailure: (pageId: string) => void;
  pageId: string;
  playing: boolean;
  playlist: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    const playlistUrl = URL.createObjectURL(
      new Blob([playlist], { type: "application/vnd.apple.mpegurl" }),
    );
    let cancelled = false;
    let hls: HlsType | undefined;

    const load = async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setFailed(true);
              onFailure(pageId);
            }
          });
          hls.loadSource(playlistUrl);
          hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playlistUrl;
          video.load();
        } else {
          setFailed(true);
          onFailure(pageId);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          onFailure(pageId);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(playlistUrl);
    };
  }, [onFailure, pageId, playlist]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - localTimeSeconds) > 0.35) {
      video.currentTime = Math.min(localTimeSeconds, video.duration || localTimeSeconds);
    }
    if (playing && video.paused) {
      void video.play().catch(() => undefined);
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [active, localTimeSeconds, playing]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      aria-label="Recorded Scout browser session"
      aria-hidden={!active}
      onError={() => {
        setFailed(true);
        onFailure(pageId);
      }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          onAspectRatio(video.videoWidth / video.videoHeight);
        }
      }}
      className={`absolute inset-0 block size-full object-contain transition-opacity duration-150 motion-reduce:transition-none ${
        active && !failed ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    />
  );
}

function replayPageLabel(
  page: { pageUrl: string | null; binding?: { kind: string } },
  index: number,
) {
  if (!page.pageUrl) {
    return page.binding?.kind === "unmatched"
      ? `Unmatched recording ${index + 1}`
      : `Tab ${index + 1}`;
  }
  const url = new URL(page.pageUrl);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

function formatReplayTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  if (!run.matchesCurrentClaim && run.generation.status !== "pending") return "Needs retest";
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

function validateClaimEdit(fields: ClaimEditFields, domain: string) {
  if (!fields.claim.trim()) return "Claim cannot be empty.";
  if (Array.from(fields.claim.trim()).length > 1_200) {
    return "Claim must be 1,200 characters or fewer.";
  }
  if (!fields.suggestedMysteryShop.trim()) return "Test instructions cannot be empty.";
  if (Array.from(fields.suggestedMysteryShop.trim()).length > 1_200) {
    return "Test instructions must be 1,200 characters or fewer.";
  }

  let url: URL;
  try {
    url = new URL(fields.sourceUrl.trim());
  } catch {
    return "Starting URL must be a valid URL.";
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return "Starting URL must use HTTP or HTTPS without credentials.";
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
    return `Starting URL must belong to ${domain}.`;
  }
  return null;
}

function claimUpdateError(error: unknown) {
  if (!(error instanceof Error)) return "Could not save the claim.";
  const messages = [
    ["Claim cannot be empty", "Claim cannot be empty."],
    ["Claim must be 1200 characters or fewer", "Claim must be 1,200 characters or fewer."],
    ["Starting URL must be a valid URL", "Starting URL must be a valid URL."],
    [
      "Starting URL must use HTTP or HTTPS without credentials",
      "Starting URL must use HTTP or HTTPS without credentials.",
    ],
    ["Test instructions cannot be empty", "Test instructions cannot be empty."],
    [
      "Test instructions must be 1200 characters or fewer",
      "Test instructions must be 1,200 characters or fewer.",
    ],
    [
      "Claim not found in the current completed investigation",
      "Claim is no longer part of the current investigation.",
    ],
  ] as const;
  const known = messages.find(([needle]) => error.message.includes(needle));
  if (known) return known[1];
  const domainError = error.message.match(/Starting URL must belong to ([a-z0-9.-]+)/i);
  return domainError
    ? `Starting URL must belong to ${domainError[1]}.`
    : "Could not save the claim.";
}
