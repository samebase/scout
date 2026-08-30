import { useUIMessages } from "@convex-dev/agent/react";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  HandIcon,
  LoaderCircleIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ClaimRunReplay } from "#components/claim-run-replay";
import { ServiceIcon } from "#components/service-icon";
import type { ScoutRunMessage } from "#components/scout-run-message";
import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";
import { cn } from "#lib/utils";

type Product = NonNullable<FunctionReturnType<typeof api.products.getByDomain>>;
type ResolvedClaim = NonNullable<FunctionReturnType<typeof api.products.getClaimByDomain>>;
type ClaimRun = FunctionReturnType<typeof api.claimTests.listRuns>[number];
type ClaimRunDetail = NonNullable<FunctionReturnType<typeof api.claimTests.getRun>>;
type LinkedServiceAccount = NonNullable<
  FunctionReturnType<typeof api.scout.serviceAccounts.forClaimTestRun>
>;
type BrowserSession = FunctionReturnType<typeof api.claimTests.listBrowserSessions>[number];
type BrowserSessionDetail = NonNullable<
  FunctionReturnType<typeof api.claimTests.getBrowserSession>
>;
type BrowserOperation = BrowserSessionDetail["operations"][number];
type HumanHandoff = NonNullable<FunctionReturnType<typeof api.claimTestHumanHandoffs.active>>;

type MainMode = "browser" | "result" | "target";
type StartState = { kind: "idle" } | { kind: "starting" } | { kind: "failed"; message: string };
type ContinueState =
  | { kind: "idle" }
  | { kind: "continuing" }
  | { kind: "failed"; message: string };
type HandoffState = { kind: "idle" } | { kind: "continuing" } | { kind: "failed"; message: string };
type ClaimEditFields = {
  claim: string;
  suggestedMysteryShop: string;
};
type ClaimEditState =
  | { kind: "closed" }
  | { kind: "editing"; fields: ClaimEditFields; error: string | null }
  | { kind: "saving"; fields: ClaimEditFields };
type ClaimRemoveState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "removing" }
  | { kind: "failed"; message: string };

const RUN_RESIZE_HANDLE_LABELS = {
  left: "Resize runs pane",
  right: "Resize sessions pane",
} satisfies SidebarLayoutResizeHandleLabels;

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  String(widthPx) + " pixels wide";

const compactDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const preciseDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export function ClaimRunWorkspace({
  claimKey,
  domain,
  runId,
}: {
  claimKey: string;
  domain: string;
  runId?: string;
}) {
  const navigate = useNavigate();
  const product = useQuery(api.products.getByDomain, { domain });
  const resolvedClaim = useQuery(api.products.getClaimByDomain, { claimKey, domain });
  const runs = useQuery(api.claimTests.listRuns, { claimKey, domain });
  const selectedRunSummary = runs?.find((run) => run.runId === runId);
  const selectedRun = useQuery(api.claimTests.getRun, runId ? { runId, domain, claimKey } : "skip");
  const linkedServiceAccount = useQuery(
    api.scout.serviceAccounts.forClaimTestRun,
    selectedRun ? { runId: selectedRun.runId } : "skip",
  );
  const sessions = useQuery(
    api.claimTests.listBrowserSessions,
    selectedRun ? { runId: selectedRun.runId } : "skip",
  );
  const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null);
  const selectedSessionSummary = useMemo(
    () => selectSession(sessions, pinnedSessionId),
    [pinnedSessionId, sessions],
  );
  const selectedSession = useQuery(
    api.claimTests.getBrowserSession,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const liveView = useQuery(
    api.claimTests.liveView,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const humanHandoff = useQuery(
    api.claimTestHumanHandoffs.active,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const runMessages = useUIMessages(
    api.scout.lab.listMessages,
    selectedRun ? { threadId: selectedRun.threadId } : "skip",
    { initialNumItems: 50, stream: true },
  );
  const [mode, setMode] = useState<MainMode>("browser");
  const [newRunOpen, setNewRunOpen] = useState(false);

  useEffect(() => {
    const latest = runs?.[0];
    if (runId !== undefined || latest === undefined) return;
    void navigate({
      to: "/products/$domain/claims/$claimKey/runs/$runId",
      params: { claimKey, domain, runId: latest.runId },
      replace: true,
    });
  }, [claimKey, domain, navigate, runId, runs]);

  useEffect(() => {
    setPinnedSessionId(null);
    setMode("browser");
    setNewRunOpen(false);
  }, [runId]);

  const loading =
    product === undefined ||
    resolvedClaim === undefined ||
    runs === undefined ||
    (runId !== undefined && selectedRun === undefined);
  const runMissing = runId !== undefined && selectedRun === null;
  const messages = selectedRun ? runMessages.results : [];
  const hasRunningRun = runs?.some((run) => run.state.kind === "running") ?? false;

  return (
    <>
      <SidebarLayout
        addressChrome={
          <ClaimRunChrome
            loading={loading}
            newRunOpen={newRunOpen}
            newRunAvailable={resolvedClaim !== null && resolvedClaim !== undefined}
            product={product ?? undefined}
            run={selectedRun ?? selectedRunSummary}
            onToggleNewRun={() => setNewRunOpen((open) => !open)}
          />
        }
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <RunsPane
                claimKey={claimKey}
                domain={domain}
                runs={runs}
                selectedRunId={selectedRun?.runId ?? selectedRunSummary?.runId}
              />
            }
            header={<RunsHeader domain={domain} />}
            scrollRestorationId={"claim-runs:" + domain + ":" + claimKey}
          />
        }
        main={
          <PaneFrame
            content={
              <RunMain
                claimKey={claimKey}
                domain={domain}
                handoff={humanHandoff ?? null}
                hasRunningRun={hasRunningRun}
                liveViewUrl={liveView?.url ?? null}
                linkedServiceAccount={linkedServiceAccount ?? undefined}
                loading={loading}
                messages={messages}
                mode={mode}
                newRunOpen={newRunOpen}
                product={product ?? undefined}
                resolvedClaim={resolvedClaim}
                run={selectedRun ?? undefined}
                runMissing={runMissing}
                selectedSession={selectedSession ?? undefined}
                selectedSessionSummary={selectedSessionSummary}
                onCloseNewRun={() => setNewRunOpen(false)}
              />
            }
            header={
              <RunModeHeader
                disabled={!selectedRun}
                mode={selectedRun ? mode : "target"}
                onModeChange={setMode}
              />
            }
            scrollRestorationId={
              "claim-run-main:" + domain + ":" + claimKey + ":" + (runId ?? "new")
            }
          />
        }
        right={
          <PaneFrame
            content={
              <SessionsPane
                loading={selectedRun !== undefined && sessions === undefined}
                run={selectedRun ?? undefined}
                selectedSession={selectedSession ?? undefined}
                selectedSessionId={selectedSessionSummary?.sessionId}
                sessions={sessions}
                onSelect={(sessionId) => setPinnedSessionId(sessionId)}
              />
            }
            footer={selectedRun ? <RunTraceFooter run={selectedRun} /> : undefined}
            header={<SessionsHeader sessions={sessions} />}
            scrollRestorationId={"claim-run-sessions:" + (runId ?? "none")}
          />
        }
        resizeHandleLabels={RUN_RESIZE_HANDLE_LABELS}
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

function ClaimRunChrome({
  loading,
  newRunAvailable,
  newRunOpen,
  product,
  run,
  onToggleNewRun,
}: {
  loading: boolean;
  newRunAvailable: boolean;
  newRunOpen: boolean;
  product: Product | undefined;
  run: ClaimRun | undefined;
  onToggleNewRun: () => void;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, mobilePane, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const runsShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const sessionsShown = isMobile ? mobilePane === "right" : rightDesktopOpen;

  const toggleRuns = () => {
    if (isMobile) setMobilePane(runsShown ? "main" : "left");
    else toggleLeftPane();
  };
  const toggleSessions = () => {
    if (isMobile) setMobilePane(sessionsShown ? "main" : "right");
    else toggleRightPane();
  };

  return (
    <div className="claim-run-chrome">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={runsShown ? "Hide runs" : "Show runs"}
        aria-pressed={runsShown}
        onClick={toggleRuns}
      >
        <PanelLeftIcon />
      </Button>
      {product ? (
        <ServiceIcon
          serviceName={product.name}
          serviceDomain={product.domain}
          className="size-5 shrink-0 rounded"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xs font-semibold">
          {loading ? "Loading" : (product?.name ?? "Claim not found")}
        </h1>
        {run ? (
          <p className="truncate font-mono text-[10px] text-muted-foreground">{run.runId}</p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={newRunOpen ? "secondary" : "outline"}
        aria-expanded={newRunOpen}
        disabled={!newRunAvailable}
        onClick={() => {
          onToggleNewRun();
          setMobilePane("main");
        }}
      >
        <PlusIcon />
        <span className="hidden @xs:inline">New run</span>
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={sessionsShown ? "Hide sessions" : "Show sessions"}
        aria-pressed={sessionsShown}
        onClick={toggleSessions}
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
}

function RunsHeader({ domain }: { domain: string }) {
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-2">
      <Link
        to="/products/$domain"
        params={{ domain }}
        className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">Runs</span>
      </Link>
    </div>
  );
}

function RunsPane({
  claimKey,
  domain,
  runs,
  selectedRunId,
}: {
  claimKey: string;
  domain: string;
  runs: ClaimRun[] | undefined;
  selectedRunId: ClaimRun["runId"] | undefined;
}) {
  const { setMobilePane } = useSidebarActions();
  if (runs === undefined) return <PaneStatus>Loading runs</PaneStatus>;
  if (runs.length === 0) return <PaneStatus>No runs</PaneStatus>;

  return (
    <nav aria-label="Claim runs">
      <ol className="divide-y">
        {runs.map((run) => {
          const selected = run.runId === selectedRunId;
          return (
            <li key={run.runId}>
              <Link
                to="/products/$domain/claims/$claimKey/runs/$runId"
                params={{ claimKey, domain, runId: run.runId }}
                aria-current={selected ? "page" : undefined}
                data-selected={selected ? "" : undefined}
                className="claim-run-row"
                onClick={() => setMobilePane("main")}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <StatusDot className={runDotClass(run)} />
                  <span className="truncate text-xs font-medium">{runLabel(run)}</span>
                  {!run.matchesCurrentClaim ? (
                    <span className="text-[10px] text-amber-700 dark:text-amber-300">Outdated</span>
                  ) : null}
                </span>
                <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <time className="tabular-nums" dateTime={new Date(run.createdAt).toISOString()}>
                    {compactDate.format(run.createdAt)}
                  </time>
                  <span className="truncate">{run.scout.displayName}</span>
                </span>
                <code
                  className="mt-1 block truncate text-[9px] text-muted-foreground"
                  title={run.runId}
                >
                  {run.runId}
                </code>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function RunModeHeader({
  disabled,
  mode,
  onModeChange,
}: {
  disabled: boolean;
  mode: MainMode;
  onModeChange: (mode: MainMode) => void;
}) {
  return (
    <div className="claim-run-modes" aria-label="Run view">
      {(["browser", "result", "target"] as const).map((item) => (
        <button
          key={item}
          type="button"
          data-selected={mode === item ? "" : undefined}
          disabled={disabled && item !== "target"}
          onClick={() => onModeChange(item)}
        >
          {modeLabel(item)}
        </button>
      ))}
    </div>
  );
}

function RunMain({
  claimKey,
  domain,
  handoff,
  hasRunningRun,
  liveViewUrl,
  linkedServiceAccount,
  loading,
  messages,
  mode,
  newRunOpen,
  product,
  resolvedClaim,
  run,
  runMissing,
  selectedSession,
  selectedSessionSummary,
  onCloseNewRun,
}: {
  claimKey: string;
  domain: string;
  handoff: HumanHandoff | null;
  hasRunningRun: boolean;
  liveViewUrl: string | null;
  linkedServiceAccount: LinkedServiceAccount | undefined;
  loading: boolean;
  messages: readonly ScoutRunMessage[];
  mode: MainMode;
  newRunOpen: boolean;
  product: Product | undefined;
  resolvedClaim: ResolvedClaim | null | undefined;
  run: ClaimRunDetail | undefined;
  runMissing: boolean;
  selectedSession: BrowserSessionDetail | undefined;
  selectedSessionSummary: BrowserSession | undefined;
  onCloseNewRun: () => void;
}) {
  if (loading) return <MainStatus>Loading claim</MainStatus>;
  if (!product || (!resolvedClaim && !run)) return <MainStatus>Claim not found</MainStatus>;

  return (
    <main className="claim-run-main">
      {newRunOpen && resolvedClaim ? (
        <NewRunControls claimKey={claimKey} domain={domain} onClose={onCloseNewRun} />
      ) : null}
      {runMissing ? (
        <MainStatus>Run not found</MainStatus>
      ) : !run ? (
        <TargetView
          claimKey={claimKey}
          currentClaim={resolvedClaim?.claim ?? null}
          domain={domain}
          hasRunningRun={hasRunningRun}
          product={product}
        />
      ) : (
        <>
          <RunMetadataStrip account={linkedServiceAccount} run={run} />
          <div className="min-h-0 flex-1">
            {mode === "browser" ? (
              <BrowserView
                handoff={handoff}
                liveViewUrl={liveViewUrl}
                run={run}
                session={selectedSession}
                sessionSummary={selectedSessionSummary}
              />
            ) : mode === "result" ? (
              <ResultView messages={messages} run={run} />
            ) : (
              <TargetView
                claimKey={claimKey}
                currentClaim={resolvedClaim?.claim ?? null}
                domain={domain}
                hasRunningRun={hasRunningRun}
                product={product}
                run={run}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function NewRunControls({
  claimKey,
  domain,
  onClose,
}: {
  claimKey: string;
  domain: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const scouts = useQuery(api.scout.scouts.list, {});
  const startRun = useMutation(api.claimTests.start);
  const [profile, setProfile] = useState("fresh");
  const [allowAccountCreation, setAllowAccountCreation] = useState(false);
  const [state, setState] = useState<StartState>({ kind: "idle" });
  const selectedScout = scouts?.find((scout) => scout._id === profile);
  const serviceAccounts = useQuery(
    api.scout.serviceAccounts.list,
    selectedScout ? { scoutId: selectedScout._id } : "skip",
  );
  const managedServiceAccount = serviceAccounts?.find(
    (account) => account.serviceDomain === domain && account.managedCredential !== undefined,
  );
  const starting = state.kind === "starting";

  const changeProfile = (value: string) => {
    setProfile(value);
    if (value === "fresh") setAllowAccountCreation(false);
    if (state.kind === "failed") setState({ kind: "idle" });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (starting) return;
    if (allowAccountCreation && managedServiceAccount === undefined) {
      setState({
        kind: "failed",
        message: `Prepare a managed ${domain} account for the selected Scout first.`,
      });
      return;
    }
    setState({ kind: "starting" });
    try {
      const result = await startRun({
        claimKey,
        domain,
        browserProfile: selectedScout
          ? { kind: "scout", scoutId: selectedScout._id }
          : { kind: "fresh" },
        accountCreation: allowAccountCreation ? "required" : "not_requested",
        ...(allowAccountCreation && managedServiceAccount
          ? { serviceAccountId: managedServiceAccount._id }
          : {}),
      });
      onClose();
      await navigate({
        to: "/products/$domain/claims/$claimKey/runs/$runId",
        params: { claimKey, domain, runId: result.runId },
      });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not start run") });
    }
  };

  return (
    <form className="claim-run-new" onSubmit={(event) => void submit(event)}>
      <label className="min-w-0">
        <span>Run as</span>
        <select
          value={profile}
          disabled={starting || scouts === undefined}
          onChange={(event) => changeProfile(event.currentTarget.value)}
        >
          <option value="fresh">Automatic Scout · fresh browser</option>
          {scouts
            ?.filter((scout) => scout.status === "active")
            .map((scout) => (
              <option key={scout._id} value={scout._id}>
                {scout.displayName + " · saved browser"}
              </option>
            ))}
        </select>
      </label>
      <label className="claim-run-account-toggle">
        <input
          type="checkbox"
          checked={allowAccountCreation}
          disabled={starting || managedServiceAccount === undefined}
          onChange={(event) => setAllowAccountCreation(event.currentTarget.checked)}
        />
        <span>
          {managedServiceAccount
            ? `Create or recover ${managedServiceAccount.identifier}`
            : "Create or recover an account"}
        </span>
      </label>
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={starting || scouts === undefined}>
          {starting ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
          {starting ? "Starting" : "Start"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={starting} onClick={onClose}>
          Close
        </Button>
      </div>
      {state.kind === "failed" ? (
        <p
          className="col-span-full flex items-center gap-1.5 text-xs text-destructive"
          role="alert"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" />
          {state.message}
        </p>
      ) : null}
      {selectedScout && serviceAccounts !== undefined && managedServiceAccount === undefined ? (
        <p className="col-span-full text-xs text-muted-foreground">
          Add a managed account for {domain} to {selectedScout.displayName} before enabling account
          creation.
        </p>
      ) : null}
    </form>
  );
}

function RunMetadataStrip({
  account,
  run,
}: {
  account: LinkedServiceAccount | undefined;
  run: ClaimRunDetail;
}) {
  return (
    <dl className="claim-run-metadata">
      <Metadata label="Run" value={run.runId} mono />
      <Metadata label="State" value={runLabel(run)} />
      <Metadata label="Scout identity" value={run.scout.displayName} />
      <Metadata label="Browser state" value={runProfileLabel(run)} />
      <Metadata
        label="Account task"
        value={run.accountCreation === "required" ? "Create or recover" : "None"}
      />
      {run.accountCreation === "required" ? (
        <Metadata label="Service account" value={linkedAccountLabel(account, run)} mono />
      ) : null}
      <Metadata label="Started" value={preciseDate.format(run.generation.startedAt)} />
      <Metadata label="Worker model" value={run.generation.model} mono />
      {run.generation.status !== "pending" && run.generation.firecrawlCredits !== null ? (
        <Metadata label="Credits" value={String(run.generation.firecrawlCredits)} />
      ) : null}
    </dl>
  );
}

function Metadata({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")} title={value}>
        {value}
      </dd>
    </div>
  );
}

function BrowserView({
  handoff,
  liveViewUrl,
  run,
  session,
  sessionSummary,
}: {
  handoff: HumanHandoff | null;
  liveViewUrl: string | null;
  run: ClaimRunDetail;
  session: BrowserSessionDetail | undefined;
  sessionSummary: BrowserSession | undefined;
}) {
  if (!sessionSummary) {
    return run.state.kind === "running" ? (
      <MainStatus>Waiting for browser</MainStatus>
    ) : (
      <MainStatus>No browser sessions</MainStatus>
    );
  }
  if (session === undefined) return <MainStatus>Loading session</MainStatus>;
  if (handoff) return <HumanHandoffView handoff={handoff} session={session} />;
  if (session.lifecycle.kind === "active") {
    return liveViewUrl ? (
      <LiveBrowser session={session} url={liveViewUrl} />
    ) : (
      <MainStatus>Connecting</MainStatus>
    );
  }
  return <ClaimRunReplay sessionId={session.sessionId} />;
}

function LiveBrowser({ session, url }: { session: BrowserSessionDetail; url: string }) {
  return (
    <section className="claim-run-browser" aria-label="Live browser">
      <div className="claim-run-browser__bar">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="truncate text-xs font-medium">Live · Session {session.sequence}</span>
        </span>
        <Button asChild size="xs" variant="ghost">
          <a href={url} target="_blank" rel="noreferrer">
            Open
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="claim-run-browser__narrow">
        <a href={url} target="_blank" rel="noreferrer">
          Open live browser
        </a>
      </div>
      <iframe
        src={url}
        title={"Live browser for session " + session.sessionId}
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        className="claim-run-browser__frame"
      />
    </section>
  );
}

function HumanHandoffView({
  handoff,
  session,
}: {
  handoff: HumanHandoff;
  session: BrowserSessionDetail;
}) {
  const continueHandoff = useMutation(api.claimTestHumanHandoffs.continueHandoff);
  const [state, setState] = useState<HandoffState>({ kind: "idle" });
  const submit = async () => {
    setState({ kind: "continuing" });
    try {
      const continued = await continueHandoff({ handoffId: handoff.handoffId });
      if (!continued) {
        setState({ kind: "failed", message: "Handoff is no longer active." });
        return;
      }
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not continue Scout") });
    }
  };

  return (
    <section className="claim-run-browser" aria-label="Human handoff">
      <div className="claim-run-handoff">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <HandIcon className="size-3.5 shrink-0 text-amber-600" />
          <strong className="truncate text-xs">Human action required</strong>
        </span>
        <span className="truncate text-xs text-muted-foreground" title={handoff.reason}>
          {handoff.reason}
        </span>
        <time className="text-[10px] tabular-nums text-muted-foreground">
          Expires {preciseDate.format(handoff.expiresAt)}
        </time>
        <Button asChild size="xs" variant="outline">
          <a href={handoff.url} target="_blank" rel="noreferrer">
            Open
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={state.kind === "continuing"}
          onClick={() => void submit()}
        >
          {state.kind === "continuing" ? <LoaderCircleIcon className="animate-spin" /> : null}
          Continue Scout
        </Button>
      </div>
      <div className="claim-run-browser__narrow">
        <a href={handoff.url} target="_blank" rel="noreferrer">
          Open takeover
        </a>
      </div>
      <iframe
        src={handoff.url}
        title={"Interactive browser for session " + session.sessionId}
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-same-origin allow-scripts"
        className="claim-run-browser__frame"
      />
      {state.kind === "failed" ? (
        <p className="border-t px-2 py-1.5 text-xs text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

function ResultView({
  messages,
  run,
}: {
  messages: readonly ScoutRunMessage[];
  run: ClaimRunDetail;
}) {
  const text = latestAssistantText(messages);
  const details = text ? resultDetails(text) : null;
  return (
    <section className="claim-run-result" aria-label="Run result">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot className={runDotClass(run)} />
        <h2 className="truncate text-sm font-semibold">{runLabel(run)}</h2>
      </div>
      {run.state.kind === "failed" ? (
        <pre className="claim-run-result__text text-destructive">{run.state.failure}</pre>
      ) : run.state.kind === "running" ? (
        <p className="mt-3 text-xs text-muted-foreground">Running</p>
      ) : details ? (
        <pre className="claim-run-result__text">{details}</pre>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No result</p>
      )}
      {run.state.kind !== "running" ? <ContinueRun run={run} /> : null}
    </section>
  );
}

function ContinueRun({ run }: { run: ClaimRunDetail }) {
  const continueRun = useMutation(api.claimTests.continueRun);
  const [state, setState] = useState<ContinueState>({ kind: "idle" });
  const submit = async () => {
    setState({ kind: "continuing" });
    try {
      await continueRun({ runId: run.runId });
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not continue run") });
    }
  };
  return (
    <div className="mt-4 border-t pt-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={state.kind === "continuing"}
        onClick={() => void submit()}
      >
        {state.kind === "continuing" ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <RotateCcwIcon />
        )}
        {state.kind === "continuing" ? "Continuing" : "Continue run"}
      </Button>
      {state.kind === "failed" ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function TargetView({
  claimKey,
  currentClaim,
  domain,
  hasRunningRun,
  product,
  run,
}: {
  claimKey: string;
  currentClaim: ResolvedClaim["claim"] | null;
  domain: string;
  hasRunningRun: boolean;
  product: Product;
  run?: ClaimRunDetail;
}) {
  const navigate = useNavigate();
  const removeClaim = useMutation(api.products.removeClaim);
  const updateClaim = useMutation(api.products.updateClaim);
  const [editState, setEditState] = useState<ClaimEditState>({ kind: "closed" });
  const [removeState, setRemoveState] = useState<ClaimRemoveState>({ kind: "idle" });

  useEffect(() => {
    setEditState({ kind: "closed" });
    setRemoveState({ kind: "idle" });
  }, [claimKey, domain]);

  const openEdit = () => {
    if (!currentClaim) return;
    setEditState({
      kind: "editing",
      fields: {
        claim: currentClaim.claim,
        suggestedMysteryShop: currentClaim.suggestedMysteryShop,
      },
      error: null,
    });
  };

  const changeEditField = <Key extends keyof ClaimEditFields>(
    key: Key,
    value: ClaimEditFields[Key],
  ) => {
    setEditState((state) =>
      state.kind === "editing"
        ? {
            kind: "editing",
            fields: { ...state.fields, [key]: value },
            error: null,
          }
        : state,
    );
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editState.kind !== "editing") return;
    const validationError = validateClaimEdit(editState.fields);
    if (validationError) {
      setEditState({ ...editState, error: validationError });
      return;
    }
    const fields = {
      claim: editState.fields.claim.trim(),
      suggestedMysteryShop: editState.fields.suggestedMysteryShop.trim(),
    };
    setEditState({ kind: "saving", fields });
    try {
      await updateClaim({ claimKey, domain, ...fields });
      setEditState({ kind: "closed" });
    } catch (error) {
      setEditState({
        kind: "editing",
        fields,
        error: actionError(error, "Could not update claim"),
      });
    }
  };

  const remove = async () => {
    if (removeState.kind === "removing") return;
    setRemoveState({ kind: "removing" });
    try {
      await removeClaim({ claimKey, domain });
      await navigate({ to: "/products/$domain", params: { domain } });
    } catch (error) {
      setRemoveState({
        kind: "failed",
        message: actionError(error, "Could not remove claim"),
      });
    }
  };

  const editing = editState.kind !== "closed";
  const saving = editState.kind === "saving";
  const mutationLocked = hasRunningRun || editing || removeState.kind !== "idle";

  return (
    <section className="claim-run-target" aria-label="Claim target">
      {currentClaim ? (
        editing ? (
          <form className="claim-run-target__edit" onSubmit={(event) => void save(event)}>
            <div className="claim-run-target__heading">
              <span className="font-mono text-[10px] text-muted-foreground">
                Edit current target
              </span>
            </div>
            <label>
              <span>Claim</span>
              <Textarea
                className="claim-run-target__textarea"
                name="claim"
                value={editState.fields.claim}
                disabled={saving}
                maxLength={1_200}
                rows={4}
                required
                onChange={(event) => changeEditField("claim", event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Test instructions</span>
              <Textarea
                className="claim-run-target__textarea"
                name="suggestedMysteryShop"
                value={editState.fields.suggestedMysteryShop}
                disabled={saving}
                maxLength={1_200}
                rows={4}
                onChange={(event) =>
                  changeEditField("suggestedMysteryShop", event.currentTarget.value)
                }
              />
            </label>
            {editState.kind === "editing" && editState.error ? (
              <p className="claim-run-target__error" role="alert">
                <CircleAlertIcon aria-hidden="true" />
                {editState.error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="submit" size="xs" disabled={saving}>
                {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                {saving ? "Saving" : "Save"}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={saving}
                onClick={() => setEditState({ kind: "closed" })}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="claim-run-target__heading">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  Current · {currentClaim.category}
                </span>
                {currentClaim.isEdited ? (
                  <span className="text-[10px] text-muted-foreground">Edited</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={mutationLocked}
                  title={hasRunningRun ? "Run is active" : "Edit claim"}
                  onClick={openEdit}
                >
                  <PencilIcon />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Remove claim"
                  disabled={mutationLocked}
                  title={hasRunningRun ? "Run is active" : "Remove claim"}
                  onClick={() => setRemoveState({ kind: "confirming" })}
                >
                  <Trash2Icon />
                </Button>
              </span>
            </div>
            <h2>{currentClaim.claim}</h2>
            <dl>
              <div>
                <dt>Product</dt>
                <dd>{product.domain}</dd>
              </div>
              <div>
                <dt>Instructions</dt>
                <dd>{currentClaim.suggestedMysteryShop || "None"}</dd>
              </div>
              <div>
                <dt>Claim key</dt>
                <dd className="font-mono">{claimKey}</dd>
              </div>
            </dl>
          </>
        )
      ) : (
        <div className="claim-run-target__heading">
          <span className="font-mono text-[10px] text-muted-foreground">Current target</span>
          <span className="text-[10px] text-muted-foreground">Unavailable</span>
        </div>
      )}
      {removeState.kind !== "idle" ? (
        <div className="claim-run-target__remove">
          {removeState.kind === "failed" ? (
            <p className="text-xs text-destructive" role="alert">
              {removeState.message}
            </p>
          ) : (
            <p className="text-xs font-medium">Remove claim?</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="destructive"
              disabled={removeState.kind === "removing"}
              onClick={() => void remove()}
            >
              {removeState.kind === "removing" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
              {removeState.kind === "removing"
                ? "Removing"
                : removeState.kind === "failed"
                  ? "Retry"
                  : "Remove"}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={removeState.kind === "removing"}
              onClick={() => setRemoveState({ kind: "idle" })}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {run ? (
        <div className="claim-run-target__snapshot">
          <div className="claim-run-target__heading">
            <span className="font-mono text-[10px] text-muted-foreground">Run snapshot</span>
            <span
              className={cn(
                "text-[10px]",
                run.matchesCurrentClaim
                  ? "text-muted-foreground"
                  : "text-amber-700 dark:text-amber-300",
              )}
            >
              {run.matchesCurrentClaim ? "Matches current" : "Outdated"}
            </span>
          </div>
          <h2>{run.testedClaim.claim}</h2>
          <dl>
            <div>
              <dt>Instructions</dt>
              <dd>{run.testedClaim.suggestedMysteryShop || "None"}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd className="font-mono">{run.runId}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function SessionsHeader({ sessions }: { sessions: BrowserSession[] | undefined }) {
  return (
    <div className="flex h-full min-w-0 items-center justify-between gap-2 px-2">
      <span className="truncate text-xs font-semibold">Sessions</span>
      {sessions ? (
        <span className="text-[10px] tabular-nums text-muted-foreground">{sessions.length}</span>
      ) : null}
    </div>
  );
}

function SessionsPane({
  loading,
  run,
  selectedSession,
  selectedSessionId,
  sessions,
  onSelect,
}: {
  loading: boolean;
  run: ClaimRunDetail | undefined;
  selectedSession: BrowserSessionDetail | undefined;
  selectedSessionId: BrowserSession["sessionId"] | undefined;
  sessions: BrowserSession[] | undefined;
  onSelect: (sessionId: string) => void;
}) {
  if (!run) return <aside aria-label="Sessions" />;
  if (loading || sessions === undefined) return <PaneStatus>Loading sessions</PaneStatus>;
  if (sessions.length === 0) {
    return (
      <aside aria-label="Sessions">
        <PaneStatus>
          {run.state.kind === "running" ? "Waiting for session" : "No sessions"}
        </PaneStatus>
      </aside>
    );
  }

  return (
    <aside aria-label="Sessions">
      <ol className="divide-y border-b">
        {sessions.map((session) => (
          <li key={session.sessionId}>
            <button
              type="button"
              className="claim-session-row"
              data-selected={session.sessionId === selectedSessionId ? "" : undefined}
              aria-pressed={session.sessionId === selectedSessionId}
              onClick={() => onSelect(session.sessionId)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusDot className={sessionDotClass(session)} />
                <span className="truncate text-xs font-medium">Session {session.sequence}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {sessionLifecycleLabel(session)}
                </span>
              </span>
              <span className="mt-1 block truncate text-left text-[10px] text-muted-foreground">
                {sessionProfileLabel(session)}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center justify-between gap-1 text-[9px] text-muted-foreground">
                <time
                  className="truncate tabular-nums"
                  dateTime={new Date(session.createdAt).toISOString()}
                >
                  {compactDate.format(session.createdAt)}
                </time>
                <span className="shrink-0 tabular-nums">
                  {session.viewport.width}×{session.viewport.height} · {session.operationCount} ops
                </span>
              </span>
              <code
                className="mt-0.5 block truncate text-left text-[9px] text-muted-foreground"
                title={session.sessionId}
              >
                {session.sessionId}
              </code>
            </button>
          </li>
        ))}
      </ol>
      <div className="claim-operations-heading">
        <span>Operations</span>
        {selectedSession ? <span>{selectedSession.operations.length}</span> : null}
      </div>
      {selectedSession === undefined ? (
        <PaneStatus>Loading activity</PaneStatus>
      ) : selectedSession.operations.length === 0 ? (
        <PaneStatus>
          {selectedSession.lifecycle.kind === "active"
            ? "Waiting for activity"
            : "No recorded operations"}
        </PaneStatus>
      ) : (
        <ol className="divide-y" aria-label="Browser operations">
          {selectedSession.operations.map((operation) => (
            <OperationRow key={operation.operationId} operation={operation} />
          ))}
        </ol>
      )}
    </aside>
  );
}

function OperationRow({ operation }: { operation: BrowserOperation }) {
  const failure =
    operation.state.kind === "failed_before_dispatch" ||
    operation.state.kind === "indeterminate_after_dispatch"
      ? operation.state.failure
      : undefined;
  return (
    <li className="claim-operation-row" title={failure ?? operation.operationId}>
      <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
        {String(operation.sequence).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium">
          {operationActionLabel(operation)}
        </span>
        <span className="block truncate font-mono text-[9px] text-muted-foreground">
          {operationTarget(operation)}
        </span>
        <span className="block truncate font-mono text-[8px] text-muted-foreground/80">
          {operation.operationId}
        </span>
      </span>
      <span className="text-right">
        <span className={cn("block text-[9px]", operationStateClass(operation))}>
          {operationStateLabel(operation)}
        </span>
        <time
          className="block text-[8px] tabular-nums text-muted-foreground"
          dateTime={new Date(operationStateTime(operation)).toISOString()}
        >
          {compactDate.format(operationStateTime(operation))}
        </time>
      </span>
    </li>
  );
}

function RunTraceFooter({ run }: { run: ClaimRunDetail }) {
  return (
    <Button asChild size="sm" variant="ghost" className="m-1.5 w-[calc(100%-0.75rem)]">
      <Link to="/lab" search={{ experiment: run.experimentId, thread: run.threadId }}>
        <TerminalSquareIcon />
        <span className="truncate">Open agent trace</span>
      </Link>
    </Button>
  );
}

function PaneStatus({ children }: { children: string }) {
  return (
    <p className="px-2 py-6 text-center text-xs text-muted-foreground" role="status">
      {children}
    </p>
  );
}

function MainStatus({ children }: { children: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center px-3 py-8">
      <p className="text-center text-xs text-muted-foreground" role="status">
        {children}
      </p>
    </div>
  );
}

function StatusDot({ className }: { className: string }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function selectSession(sessions: BrowserSession[] | undefined, pinnedSessionId: string | null) {
  if (!sessions || sessions.length === 0) return undefined;
  if (pinnedSessionId) {
    const pinned = sessions.find((session) => session.sessionId === pinnedSessionId);
    if (pinned) return pinned;
  }
  const active = sessions.find((session) => session.lifecycle.kind === "active");
  if (active) return active;
  return sessions.reduce((latest, session) =>
    session.sequence > latest.sequence ? session : latest,
  );
}

function modeLabel(mode: MainMode) {
  switch (mode) {
    case "browser":
      return "Browser";
    case "result":
      return "Result";
    case "target":
      return "Target";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function runLabel(run: ClaimRun) {
  switch (run.state.kind) {
    case "running":
      return "Running";
    case "completed":
      return verdictLabel(run.state.outcome.verdict);
    case "failed":
      return "Failed";
    default: {
      const exhaustive: never = run.state;
      return exhaustive;
    }
  }
}

function runDotClass(run: ClaimRun) {
  switch (run.state.kind) {
    case "running":
      return "bg-blue-500";
    case "completed":
      return verdictDotClass(run.state.outcome.verdict);
    case "failed":
      return "bg-destructive";
    default: {
      const exhaustive: never = run.state;
      return exhaustive;
    }
  }
}

function verdictLabel(
  verdict: Extract<ClaimRun["state"], { kind: "completed" }>["outcome"]["verdict"],
) {
  switch (verdict) {
    case "supported":
      return "Supported";
    case "qualified":
      return "Qualified";
    case "refuted":
      return "Refuted";
    case "inconclusive":
      return "Inconclusive";
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function verdictDotClass(
  verdict: Extract<ClaimRun["state"], { kind: "completed" }>["outcome"]["verdict"],
) {
  switch (verdict) {
    case "supported":
      return "bg-emerald-500";
    case "qualified":
      return "bg-amber-500";
    case "refuted":
      return "bg-red-500";
    case "inconclusive":
      return "bg-slate-400";
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function runProfileLabel(run: ClaimRun) {
  return run.browserProfile.kind === "fresh"
    ? "Fresh browser"
    : `Saved · ${run.browserProfile.profileName}`;
}

function linkedAccountLabel(account: LinkedServiceAccount | undefined, run: ClaimRunDetail) {
  if (!account) return run.state.kind === "running" ? "Pending" : "Not recorded";
  const first = account.firstRecordedByClaimTest;
  if (first?.runId === run.runId) {
    return `${first.accountAccess === "created" ? "Created" : "Recovered"} · ${account.identifier}`;
  }
  return `Reverified · ${account.identifier}`;
}

function sessionLifecycleLabel(session: BrowserSession) {
  if (session.lifecycle.kind === "active") return "Live";
  return "Closed";
}

function sessionDotClass(session: BrowserSession) {
  if (session.lifecycle.kind === "active") return "bg-blue-500";
  return "bg-muted-foreground";
}

function sessionProfileLabel(session: BrowserSession) {
  return session.profileName ? `Saved · ${session.profileName}` : "Fresh browser";
}

function operationActionLabel(operation: BrowserOperation) {
  return operation.action.kind.replaceAll("_", " ");
}

function operationTarget(operation: BrowserOperation) {
  const action = operation.action;
  switch (action.kind) {
    case "open":
    case "navigate":
      return action.url;
    case "click":
      return action.ref;
    case "fill":
    case "type":
      return action.ref + " · " + action.characterCount + " chars";
    case "press":
      return action.key;
    case "select":
    case "check":
      return action.ref;
    case "switch_tab":
      return action.tabId;
    case "back":
    case "reload":
      return "";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function operationStateLabel(operation: BrowserOperation) {
  switch (operation.state.kind) {
    case "prepared":
      return "Prepared";
    case "applied":
      return "Applied";
    case "applied_snapshot_failed":
      return "Snapshot failed";
    case "failed_before_dispatch":
      return "Not sent";
    case "indeterminate_after_dispatch":
      return "Unknown";
    default: {
      const exhaustive: never = operation.state;
      return exhaustive;
    }
  }
}

function operationStateClass(operation: BrowserOperation) {
  switch (operation.state.kind) {
    case "prepared":
      return "text-amber-700 dark:text-amber-300";
    case "applied":
      return "text-emerald-700 dark:text-emerald-300";
    case "applied_snapshot_failed":
    case "failed_before_dispatch":
    case "indeterminate_after_dispatch":
      return "text-destructive";
    default: {
      const exhaustive: never = operation.state;
      return exhaustive;
    }
  }
}

function operationStateTime(operation: BrowserOperation) {
  return operation.state.kind === "prepared"
    ? operation.state.preparedAtMs
    : operation.state.settledAtMs;
}

function latestAssistantText(messages: readonly ScoutRunMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.text.trim()) return message.text.trim();
  }
  return null;
}

function resultDetails(text: string) {
  return text
    .replace(/^\s*\**Verdict:\s*(Supported|Qualified|Refuted|Inconclusive)\**\s*/i, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replaceAll("**", "")
    .trim();
}

function actionError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback + ".";
  const message = error.message.split("\n").find((line) => line.trim());
  return message?.trim() || fallback + ".";
}

function validateClaimEdit(fields: ClaimEditFields) {
  if (!fields.claim.trim()) return "Claim cannot be empty.";
  if (Array.from(fields.claim.trim()).length > 1_200) {
    return "Claim must be 1,200 characters or fewer.";
  }
  if (Array.from(fields.suggestedMysteryShop.trim()).length > 1_200) {
    return "Test instructions must be 1,200 characters or fewer.";
  }
  return null;
}
