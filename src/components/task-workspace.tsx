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
import type { Id } from "../../convex/_generated/dataModel";
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
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ScoutRunMessageView } from "#components/scout-run-message";
import { ServiceIcon } from "#components/service-icon";
import { TaskReplay } from "#components/task-replay";
import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";
import type { TaskWorkspaceSearch, TaskWorkspaceView } from "#lib/taskWorkspaceSearch";
import { cn } from "#lib/utils";

type Task = NonNullable<FunctionReturnType<typeof api.tasks.get>>;
type Attempt = FunctionReturnType<typeof api.tasks.listAttempts>[number];
type BrowserSession = FunctionReturnType<typeof api.tasks.listBrowserSessions>[number];
type BrowserSessionDetail = NonNullable<FunctionReturnType<typeof api.tasks.getBrowserSession>>;
type BrowserOperation = BrowserSessionDetail["operations"][number];
type HumanHandoff = NonNullable<FunctionReturnType<typeof api.taskHumanHandoffs.active>>;
type TaskMessage = FunctionReturnType<typeof api.tasks.listMessages>["page"][number];

type MainMode = TaskWorkspaceView;
type ActionState = { kind: "idle" | "working" } | { kind: "failed"; message: string };

const TASK_RESIZE_HANDLE_LABELS = {
  left: "Resize attempts pane",
  right: "Resize browser sessions pane",
} satisfies SidebarLayoutResizeHandleLabels;

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;

const compactDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function TaskWorkspace({
  attemptId,
  domain,
  search,
  taskId,
  onSearchChange,
}: {
  attemptId?: string;
  domain: string;
  search: TaskWorkspaceSearch;
  taskId: string;
  onSearchChange: (search: TaskWorkspaceSearch) => void;
}) {
  const navigate = useNavigate();
  const typedTaskId = taskId as Id<"productTasks">;
  const typedAttemptId = attemptId as Id<"taskAttempts"> | undefined;
  const task = useQuery(api.tasks.get, { taskId: typedTaskId });
  const attempts = useQuery(api.tasks.listAttempts, { taskId: typedTaskId });
  const selectedAttempt = attempts?.find((attempt) => attempt.attemptId === typedAttemptId);
  const sessions = useQuery(
    api.tasks.listBrowserSessions,
    selectedAttempt ? { attemptId: selectedAttempt.attemptId } : "skip",
  );
  const turns = useQuery(
    api.tasks.listTurns,
    selectedAttempt ? { attemptId: selectedAttempt.attemptId } : "skip",
  );
  const selectedSessionSummary = useMemo(
    () => selectSession(sessions, search.session),
    [search.session, sessions],
  );
  const selectedSession = useQuery(
    api.tasks.getBrowserSession,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const liveView = useQuery(
    api.tasks.liveView,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const handoff = useQuery(
    api.taskHumanHandoffs.active,
    selectedSessionSummary ? { sessionId: selectedSessionSummary.sessionId } : "skip",
  );
  const messages = useUIMessages(
    api.tasks.listMessages,
    selectedAttempt
      ? { attemptId: selectedAttempt.attemptId, threadId: selectedAttempt.threadId }
      : "skip",
    { initialNumItems: 50, stream: true },
  );
  const [startOpen, setStartOpen] = useState(false);
  const defaultMode = selectedSessionSummary?.lifecycle.kind === "closed" ? "replay" : "live";
  const mode = search.view ?? defaultMode;

  useEffect(() => {
    const latest = attempts?.[0];
    if (attemptId !== undefined || latest === undefined || task?.product.domain !== domain) return;
    void navigate({
      to: "/products/$domain/tasks/$taskId/attempts/$attemptId",
      params: { domain, taskId, attemptId: latest.attemptId },
      search,
      replace: true,
    });
  }, [attemptId, attempts, domain, navigate, search, task?.product.domain, taskId]);

  useEffect(() => {
    setStartOpen(false);
  }, [attemptId]);

  const loading = task === undefined || attempts === undefined;
  const taskMissing = task === null || (task !== undefined && task.product.domain !== domain);
  const attemptMissing =
    attemptId !== undefined && attempts !== undefined && selectedAttempt === undefined;

  return (
    <>
      <SidebarLayout
        addressChrome={
          <TaskChrome
            attempt={selectedAttempt}
            loading={loading}
            product={task?.product}
            startOpen={startOpen}
            taskAvailable={!taskMissing && task !== undefined}
            onToggleStart={() => setStartOpen((open) => !open)}
          />
        }
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <AttemptsPane
                attemptId={typedAttemptId}
                attempts={attempts}
                domain={domain}
                view={search.view}
                taskId={taskId}
              />
            }
            header={<AttemptsHeader domain={domain} />}
            scrollRestorationId={`task-attempts:${taskId}`}
          />
        }
        main={
          <PaneFrame
            content={
              <TaskMain
                attempt={selectedAttempt}
                attemptMissing={attemptMissing}
                handoff={handoff ?? null}
                liveViewUrl={liveView?.url ?? null}
                loading={loading}
                messages={selectedAttempt ? messages.results : []}
                mode={mode}
                selectedSession={selectedSession ?? undefined}
                selectedSessionSummary={selectedSessionSummary}
                startOpen={startOpen || (attempts?.length === 0 && !taskMissing)}
                task={taskMissing ? null : (task ?? undefined)}
                taskId={typedTaskId}
                onCloseStart={() => setStartOpen(false)}
              />
            }
            header={
              <ModeHeader
                disabled={!selectedAttempt}
                mode={selectedAttempt ? mode : "transcript"}
                onModeChange={(nextMode) => onSearchChange({ ...search, view: nextMode })}
              />
            }
            scrollRestorationId={`task-main:${taskId}:${attemptId ?? "new"}`}
          />
        }
        right={
          <PaneFrame
            content={
              <SessionsPane
                attempt={selectedAttempt}
                selectedSession={selectedSession ?? undefined}
                selectedSessionId={selectedSessionSummary?.sessionId}
                sessions={sessions}
                onSelect={(sessionId) => onSearchChange({ ...search, session: sessionId })}
              />
            }
            footer={<AttemptFooter attempt={selectedAttempt} turns={turns} />}
            header={<SessionsHeader sessions={sessions} />}
            scrollRestorationId={`task-sessions:${attemptId ?? "none"}`}
          />
        }
        resizeHandleLabels={TASK_RESIZE_HANDLE_LABELS}
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

function TaskChrome({
  attempt,
  loading,
  product,
  startOpen,
  taskAvailable,
  onToggleStart,
}: {
  attempt: Attempt | undefined;
  loading: boolean;
  product: Task["product"] | undefined;
  startOpen: boolean;
  taskAvailable: boolean;
  onToggleStart: () => void;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, mobilePane, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const attemptsShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const sessionsShown = isMobile ? mobilePane === "right" : rightDesktopOpen;
  return (
    <div className="task-chrome">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={attemptsShown ? "Hide attempts" : "Show attempts"}
        aria-pressed={attemptsShown}
        onClick={() =>
          isMobile ? setMobilePane(attemptsShown ? "main" : "left") : toggleLeftPane()
        }
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
          {loading ? "Loading" : (product?.name ?? "Task not found")}
        </h1>
        {attempt ? (
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {attempt.attemptId}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={startOpen ? "secondary" : "outline"}
        disabled={!taskAvailable}
        aria-expanded={startOpen}
        onClick={() => {
          onToggleStart();
          setMobilePane("main");
        }}
      >
        {startOpen ? <XIcon /> : <PlusIcon />}
        <span className="hidden @xs:inline">{startOpen ? "Close" : "New attempt"}</span>
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={sessionsShown ? "Hide sessions" : "Show sessions"}
        aria-pressed={sessionsShown}
        onClick={() =>
          isMobile ? setMobilePane(sessionsShown ? "main" : "right") : toggleRightPane()
        }
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
}

function AttemptsHeader({ domain }: { domain: string }) {
  return (
    <div className="flex h-full min-w-0 items-center px-2">
      <Link
        to="/products/$domain"
        params={{ domain }}
        className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
        <span className="truncate">Attempts</span>
      </Link>
    </div>
  );
}

function AttemptsPane({
  attemptId,
  attempts,
  domain,
  view,
  taskId,
}: {
  attemptId: Id<"taskAttempts"> | undefined;
  attempts: Attempt[] | undefined;
  domain: string;
  view: MainMode | undefined;
  taskId: string;
}) {
  const { setMobilePane } = useSidebarActions();
  if (attempts === undefined) return <PaneStatus>Loading attempts</PaneStatus>;
  if (attempts.length === 0) return <PaneStatus>No attempts</PaneStatus>;
  return (
    <nav aria-label="Task attempts">
      <ol className="divide-y">
        {attempts.map((attempt, index) => {
          const selected = attempt.attemptId === attemptId;
          return (
            <li key={attempt.attemptId}>
              <Link
                to="/products/$domain/tasks/$taskId/attempts/$attemptId"
                params={{ domain, taskId, attemptId: attempt.attemptId }}
                search={view === undefined ? {} : { view }}
                className="task-attempt-row"
                data-selected={selected ? "" : undefined}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMobilePane("main")}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <StatusDot className={stateDot(attempt.state.kind)} />
                  <span className="truncate text-xs font-medium">
                    Attempt {attempts.length - index}
                  </span>
                  <span className="text-muted-foreground ml-auto text-[10px]">
                    {stateLabel(attempt.state.kind)}
                  </span>
                </span>
                <span className="text-muted-foreground mt-1 flex justify-between gap-2 text-[10px]">
                  <time dateTime={new Date(attempt.createdAt).toISOString()}>
                    {compactDate.format(attempt.createdAt)}
                  </time>
                  <span className="truncate">{attempt.scout.displayName}</span>
                </span>
                <span className="text-muted-foreground mt-1 flex items-center gap-2 text-[9px]">
                  <code className="min-w-0 flex-1 truncate">{attempt.attemptId}</code>
                  {attempt.latestTurnState.kind === "pending" ? (
                    <AttemptActivity label="Running" dot="bg-blue-500 animate-pulse" />
                  ) : attempt.latestTurnState.kind === "failed" ? (
                    <AttemptActivity label="Turn failed" dot="bg-destructive" />
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ModeHeader({
  disabled,
  mode,
  onModeChange,
}: {
  disabled: boolean;
  mode: MainMode;
  onModeChange: (mode: MainMode) => void;
}) {
  return (
    <div className="task-modes" aria-label="Attempt view">
      {(["live", "replay", "transcript"] as const).map((item) => (
        <button
          key={item}
          type="button"
          data-selected={mode === item ? "" : undefined}
          disabled={disabled}
          onClick={() => onModeChange(item)}
        >
          {item === "live" ? "Live" : item === "replay" ? "Replay" : "Transcript"}
        </button>
      ))}
    </div>
  );
}

function TaskMain({
  attempt,
  attemptMissing,
  handoff,
  liveViewUrl,
  loading,
  messages,
  mode,
  selectedSession,
  selectedSessionSummary,
  startOpen,
  task,
  taskId,
  onCloseStart,
}: {
  attempt: Attempt | undefined;
  attemptMissing: boolean;
  handoff: HumanHandoff | null;
  liveViewUrl: string | null;
  loading: boolean;
  messages: readonly TaskMessage[];
  mode: MainMode;
  selectedSession: BrowserSessionDetail | undefined;
  selectedSessionSummary: BrowserSession | undefined;
  startOpen: boolean;
  task: Task | null | undefined;
  taskId: Id<"productTasks">;
  onCloseStart: () => void;
}) {
  if (loading) return <MainStatus>Loading task</MainStatus>;
  if (!task) return <MainStatus>Task not found</MainStatus>;
  return (
    <main className="task-main">
      <TaskInstruction task={task} />
      {startOpen ? <StartAttemptForm task={task} taskId={taskId} onClose={onCloseStart} /> : null}
      {attemptMissing ? (
        <MainStatus>Attempt not found</MainStatus>
      ) : !attempt ? (
        <MainStatus>Start an attempt to give this Task to a Scout</MainStatus>
      ) : (
        <>
          <AttemptMetadata attempt={attempt} />
          <div className="min-h-0 flex-1">
            {mode === "live" ? (
              <LiveView
                attempt={attempt}
                handoff={handoff}
                liveViewUrl={liveViewUrl}
                session={selectedSession}
                sessionSummary={selectedSessionSummary}
              />
            ) : mode === "replay" ? (
              <ReplayView
                attempt={attempt}
                session={selectedSession}
                sessionSummary={selectedSessionSummary}
              />
            ) : (
              <Transcript attempt={attempt} messages={messages} />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function TaskInstruction({ task }: { task: Task }) {
  const navigate = useNavigate();
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [instruction, setInstruction] = useState(task.instruction);
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      await updateTask({ taskId: task.taskId, instruction: instruction.trim() });
      setEditing(false);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not update task") });
    }
  };

  const remove = async () => {
    setState({ kind: "working" });
    try {
      await removeTask({ taskId: task.taskId });
      await navigate({ to: "/products/$domain", params: { domain: task.product.domain } });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not delete task") });
      setConfirmingRemove(false);
    }
  };

  return (
    <section className="task-instruction" aria-labelledby="task-instruction-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground font-mono text-[10px]">Current instruction</p>
          {editing ? (
            <form className="mt-2" onSubmit={(event) => void save(event)}>
              <Textarea
                value={instruction}
                rows={5}
                autoFocus
                required
                maxLength={16_000}
                disabled={state.kind === "working"}
                onChange={(event) => setInstruction(event.currentTarget.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button type="submit" size="xs" disabled={state.kind === "working"}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={state.kind === "working"}
                  onClick={() => {
                    setInstruction(task.instruction);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <h2
              id="task-instruction-heading"
              className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6"
            >
              {task.instruction}
            </h2>
          )}
        </div>
        {!editing ? (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Edit task"
              onClick={() => {
                setConfirmingRemove(false);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Delete task"
              onClick={() => setConfirmingRemove(true)}
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : null}
      </div>
      {confirmingRemove ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
          <span className="min-w-0 flex-1">Delete this Task and all its attempts?</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setConfirmingRemove(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            disabled={state.kind === "working"}
            onClick={() => void remove()}
          >
            Delete
          </Button>
        </div>
      ) : null}
      {state.kind === "failed" ? <InlineError>{state.message}</InlineError> : null}
    </section>
  );
}

function StartAttemptForm({
  task,
  taskId,
  onClose,
}: {
  task: Task;
  taskId: Id<"productTasks">;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const scouts = useQuery(api.scout.scouts.list, {});
  const startAttempt = useMutation(api.tasks.startAttempt);
  const activeScouts = scouts?.filter((scout) => scout.status === "active") ?? [];
  const [scoutId, setScoutId] = useState<string>("");
  const [profileKind, setProfileKind] = useState<"scout" | "fresh">("scout");
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  useEffect(() => {
    if (!scoutId && activeScouts[0]) setScoutId(activeScouts[0]._id);
  }, [activeScouts, scoutId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = activeScouts.find((scout) => scout._id === scoutId);
    if (!selected || state.kind === "working") return;
    setState({ kind: "working" });
    try {
      const result = await startAttempt({
        taskId,
        scoutId: selected._id,
        browserProfile:
          profileKind === "scout" ? { kind: "scout", scoutId: selected._id } : { kind: "fresh" },
      });
      onClose();
      await navigate({
        to: "/products/$domain/tasks/$taskId/attempts/$attemptId",
        params: { domain: task.product.domain, taskId, attemptId: result.attemptId },
      });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not start attempt") });
    }
  };

  return (
    <form className="task-start" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Scout</span>
        <select
          value={scoutId}
          disabled={state.kind === "working" || scouts === undefined}
          onChange={(event) => setScoutId(event.currentTarget.value)}
        >
          {activeScouts.length === 0 ? <option value="">No active Scouts</option> : null}
          {activeScouts.map((scout) => (
            <option key={scout._id} value={scout._id}>
              {scout.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Browser</span>
        <select
          value={profileKind}
          disabled={state.kind === "working"}
          onChange={(event) => setProfileKind(event.currentTarget.value as "scout" | "fresh")}
        >
          <option value="scout">Scout profile</option>
          <option value="fresh">Fresh browser</option>
        </select>
      </label>
      <div className="flex items-center gap-1.5">
        <Button
          type="submit"
          size="sm"
          disabled={state.kind === "working" || activeScouts.length === 0}
        >
          {state.kind === "working" ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
          {state.kind === "working" ? "Starting" : "Start attempt"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={state.kind === "working"}
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      {state.kind === "failed" ? <InlineError>{state.message}</InlineError> : null}
    </form>
  );
}

function AttemptMetadata({ attempt }: { attempt: Attempt }) {
  return (
    <>
      <dl className="task-metadata">
        <Metadata label="Resolution" value={stateLabel(attempt.state.kind)} />
        <Metadata label="Activity" value={turnStateLabel(attempt.latestTurnState.kind)} />
        <Metadata label="Scout" value={attempt.scout.displayName} />
        <Metadata
          label="Browser"
          value={
            attempt.browserProfile.kind === "fresh" ? "Fresh" : attempt.browserProfile.profileName
          }
        />
        <Metadata
          label="Turns / sessions"
          value={`${attempt.turnCount} / ${attempt.browserSessionCount}`}
        />
      </dl>
      {attempt.state.kind === "active" ? null : (
        <div className="border-b px-2 py-2">
          <p className="text-muted-foreground font-mono text-[9px] uppercase tracking-wide">
            Conclusion
          </p>
          <p className="mt-1 text-xs leading-5">{attempt.state.conclusion}</p>
        </div>
      )}
      {attempt.state.kind === "active" && attempt.latestTurnState.kind !== "pending" ? (
        <AbandonAttempt attempt={attempt} />
      ) : null}
    </>
  );
}

function AbandonAttempt({ attempt }: { attempt: Attempt }) {
  const abandonAttempt = useMutation(api.tasks.abandonAttempt);
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const abandon = async () => {
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      await abandonAttempt({
        attemptId: attempt.attemptId,
        conclusion: "Stopped by operator.",
      });
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not abandon attempt") });
    }
  };
  return (
    <div className="flex items-center justify-end gap-2 border-b px-2 py-1.5">
      {state.kind === "failed" ? (
        <span className="text-destructive mr-auto text-[10px]">{state.message}</span>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={state.kind === "working"}
        onClick={() => void abandon()}
      >
        {state.kind === "working" ? <LoaderCircleIcon className="animate-spin" /> : <XIcon />}
        {state.kind === "working" ? "Abandoning" : "Abandon attempt"}
      </Button>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function LiveView({
  attempt,
  handoff,
  liveViewUrl,
  session,
  sessionSummary,
}: {
  attempt: Attempt;
  handoff: HumanHandoff | null;
  liveViewUrl: string | null;
  session: BrowserSessionDetail | undefined;
  sessionSummary: BrowserSession | undefined;
}) {
  if (!sessionSummary)
    return (
      <MainStatus>
        {attempt.latestTurnState.kind === "pending" ? "Waiting for browser" : "No browser session"}
      </MainStatus>
    );
  if (session === undefined) return <MainStatus>Loading browser session</MainStatus>;
  if (handoff) return <HumanHandoffView handoff={handoff} />;
  if (session.lifecycle.kind === "closed")
    return <MainStatus>Session closed. Open Replay to watch it.</MainStatus>;
  if (!liveViewUrl) return <MainStatus>Connecting to live browser</MainStatus>;
  return <BrowserFrame session={session} url={liveViewUrl} />;
}

function BrowserFrame({ session, url }: { session: BrowserSessionDetail; url: string }) {
  return (
    <section className="task-browser" aria-label="Live browser">
      <div className="task-browser-bar">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LoaderCircleIcon className="size-3.5 animate-spin text-primary" />
          <span className="truncate text-xs font-medium">Live · Session {session.sequence}</span>
        </span>
        <Button asChild size="xs" variant="ghost">
          <a href={url} target="_blank" rel="noreferrer">
            Open
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="task-browser-narrow">
        <a href={url} target="_blank" rel="noreferrer">
          Open live browser
        </a>
      </div>
      <iframe
        src={url}
        title={`Live browser session ${session.sequence}`}
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        className="task-browser-frame"
      />
    </section>
  );
}

export function HumanHandoffView({ handoff }: { handoff: HumanHandoff }) {
  return (
    <section className="task-browser" aria-label="Human handoff">
      <div className="task-handoff">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <HandIcon className="size-3.5 text-amber-600" />
          <strong className="truncate text-xs">Human action required</strong>
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={handoff.reason}
        >
          {handoff.reason}
        </span>
        <time
          className="text-muted-foreground text-[10px]"
          dateTime={new Date(handoff.expiresAt).toISOString()}
        >
          {handoff.phase === "unclaimed" ? "Open by" : "Control ends"}{" "}
          {compactDate.format(handoff.expiresAt)}
        </time>
        <Button asChild size="xs" variant="outline">
          <a href={`/handoff/${encodeURIComponent(handoff.handoffId)}`}>Open secure handoff</a>
        </Button>
      </div>
      <div className="grid flex-1 place-items-center px-6 py-12 text-center">
        <div className="max-w-sm">
          <HandIcon className="mx-auto size-8 text-amber-600" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">A person needs to complete this step.</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {handoff.phase === "unclaimed"
              ? "The private link remains available for 45 minutes. Opening it starts a separate five-minute control window."
              : "The five-minute control window is active. Complete the human step and explicitly continue Scout."}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReplayView({
  attempt,
  session,
  sessionSummary,
}: {
  attempt: Attempt;
  session: BrowserSessionDetail | undefined;
  sessionSummary: BrowserSession | undefined;
}) {
  if (!sessionSummary)
    return (
      <MainStatus>
        {attempt.latestTurnState.kind === "pending" ? "Waiting for browser" : "No browser session"}
      </MainStatus>
    );
  if (session === undefined) return <MainStatus>Loading browser session</MainStatus>;
  if (session.lifecycle.kind === "active")
    return <MainStatus>Replay becomes available when this session closes</MainStatus>;
  return (
    <TaskReplay key={session.sessionId} source={{ kind: "task", sessionId: session.sessionId }} />
  );
}

function Transcript({ attempt, messages }: { attempt: Attempt; messages: readonly TaskMessage[] }) {
  return (
    <section className="task-transcript" aria-label="Task transcript">
      {messages.length === 0 ? (
        <PaneStatus>
          {attempt.latestTurnState.kind === "pending" ? "Scout is starting" : "No messages"}
        </PaneStatus>
      ) : (
        <ol className="space-y-5">
          {messages.map((message) => (
            <li key={message.key}>
              <ScoutRunMessageView message={message} />
            </li>
          ))}
        </ol>
      )}
      {attempt.latestTurnState.kind !== "pending" && attempt.state.kind !== "completed" ? (
        <ContinueAttempt attempt={attempt} />
      ) : null}
    </section>
  );
}

function ContinueAttempt({ attempt }: { attempt: Attempt }) {
  const continueAttempt = useMutation(api.tasks.continueAttempt);
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim() || state.kind === "working") return;
    setState({ kind: "working" });
    try {
      await continueAttempt({ attemptId: attempt.attemptId, prompt: prompt.trim() });
      setPrompt("");
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not send message") });
    }
  };
  return (
    <form className="mt-6 border-t pt-4" onSubmit={(event) => void submit(event)}>
      <label className="text-xs font-semibold" htmlFor="task-follow-up">
        {attempt.state.kind === "active" ? "Message Scout" : "Resume attempt"}
      </label>
      <Textarea
        id="task-follow-up"
        className="mt-2"
        rows={3}
        value={prompt}
        disabled={state.kind === "working"}
        placeholder={
          attempt.state.kind === "active"
            ? "Continue this attempt…"
            : "Tell Scout what changed or how to continue…"
        }
        onChange={(event) => setPrompt(event.currentTarget.value)}
      />
      <div className="mt-2 flex justify-end">
        <Button type="submit" size="sm" disabled={!prompt.trim() || state.kind === "working"}>
          {state.kind === "working" ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
          {state.kind === "working" ? "Sending" : "Send"}
        </Button>
      </div>
      {state.kind === "failed" ? <InlineError>{state.message}</InlineError> : null}
    </form>
  );
}

function SessionsHeader({ sessions }: { sessions: BrowserSession[] | undefined }) {
  return (
    <div className="flex h-full items-center justify-between gap-2 px-2">
      <span className="truncate text-xs font-semibold">Browser sessions</span>
      {sessions ? (
        <span className="text-muted-foreground text-[10px]">{sessions.length}</span>
      ) : null}
    </div>
  );
}

function SessionsPane({
  attempt,
  selectedSession,
  selectedSessionId,
  sessions,
  onSelect,
}: {
  attempt: Attempt | undefined;
  selectedSession: BrowserSessionDetail | undefined;
  selectedSessionId: Id<"taskBrowserSessions"> | undefined;
  sessions: BrowserSession[] | undefined;
  onSelect: (sessionId: Id<"taskBrowserSessions">) => void;
}) {
  if (!attempt) return <aside aria-label="Browser sessions" />;
  if (sessions === undefined) return <PaneStatus>Loading sessions</PaneStatus>;
  if (sessions.length === 0)
    return (
      <PaneStatus>
        {attempt.latestTurnState.kind === "pending" ? "Waiting for browser" : "No sessions"}
      </PaneStatus>
    );
  return (
    <aside aria-label="Browser sessions">
      <ol className="divide-y border-b">
        {sessions.map((session) => (
          <li key={session.sessionId}>
            <button
              type="button"
              className="task-session-row"
              data-selected={session.sessionId === selectedSessionId ? "" : undefined}
              aria-pressed={session.sessionId === selectedSessionId}
              onClick={() => onSelect(session.sessionId)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusDot
                  className={session.lifecycle.kind === "active" ? "bg-blue-500" : "bg-emerald-500"}
                />
                <span className="truncate text-xs font-medium">Session {session.sequence}</span>
                <span className="text-muted-foreground ml-auto text-[10px]">
                  {session.lifecycle.kind}
                </span>
              </span>
              <span className="text-muted-foreground mt-1 block truncate text-left text-[10px]">
                {session.profileName ?? "Fresh browser"}
              </span>
              <span className="text-muted-foreground mt-0.5 flex justify-between text-[9px]">
                <time>{compactDate.format(session.createdAt)}</time>
                <span>
                  {session.viewport.width}×{session.viewport.height} · {session.operationCount} ops
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="task-operations-heading">
        <span>Operations</span>
        {selectedSession ? <span>{selectedSession.operations.length}</span> : null}
      </div>
      {selectedSession === undefined ? (
        <PaneStatus>Loading activity</PaneStatus>
      ) : selectedSession.operations.length === 0 ? (
        <PaneStatus>
          {selectedSession.lifecycle.kind === "active" ? "Waiting for activity" : "No operations"}
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
    <li className="task-operation-row" title={failure ?? operation.operationId}>
      <span className="text-muted-foreground font-mono text-[9px]">
        {String(operation.sequence).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium">{operation.action.kind}</span>
        <span className="text-muted-foreground line-clamp-3 whitespace-pre-wrap break-words font-mono text-[9px]">
          {operationTarget(operation)}
        </span>
      </span>
      <span
        className={cn(
          "text-right text-[9px]",
          failure
            ? "text-destructive"
            : operation.state.kind === "prepared"
              ? "text-amber-600"
              : "text-emerald-600",
        )}
      >
        {operation.state.kind}
      </span>
    </li>
  );
}

function AttemptFooter({
  attempt,
  turns,
}: {
  attempt: Attempt | undefined;
  turns: FunctionReturnType<typeof api.tasks.listTurns> | undefined;
}) {
  if (!attempt) return <div className="h-full" />;
  return (
    <div className="text-muted-foreground flex h-full items-center justify-between gap-2 px-2 text-[10px]">
      <span>{attempt.scout.displayName}</span>
      <span>
        {turns?.length ?? attempt.turnCount} turns · {attempt.browserSessionCount} sessions
      </span>
    </div>
  );
}

function operationTarget(operation: BrowserOperation) {
  switch (operation.action.kind) {
    case "open":
      return operation.action.url;
    case "execute":
      return operation.action.code;
    case "managed_password_fill":
      return `${operation.action.fieldCount} password field${operation.action.fieldCount === 1 ? "" : "s"}`;
    default: {
      const exhaustive: never = operation.action;
      return exhaustive;
    }
  }
}

function selectSession(sessions: BrowserSession[] | undefined, pinned: string | undefined) {
  if (!sessions?.length) return undefined;
  const pinnedSession = pinned
    ? sessions.find((session) => session.sessionId === pinned)
    : undefined;
  if (pinnedSession) return pinnedSession;
  return sessions.find((session) => session.lifecycle.kind === "active") ?? sessions.at(-1);
}

function stateDot(kind: Attempt["state"]["kind"]) {
  if (kind === "active") return "bg-blue-500";
  if (kind === "completed") return "bg-emerald-500";
  if (kind === "blocked") return "bg-amber-500";
  return "bg-muted-foreground";
}

function stateLabel(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function turnStateLabel(kind: Attempt["latestTurnState"]["kind"]) {
  return kind === "pending" ? "Running" : kind === "completed" ? "Turn completed" : "Turn failed";
}

function StatusDot({ className }: { className: string }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function AttemptActivity({ label, dot }: { label: string; dot: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

function PaneStatus({ children }: { children: string }) {
  return (
    <p className="text-muted-foreground px-2 py-6 text-center text-xs" role="status">
      {children}
    </p>
  );
}

function MainStatus({ children }: { children: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center px-3 py-8">
      <p className="text-muted-foreground text-center text-xs" role="status">
        {children}
      </p>
    </div>
  );
}

function InlineError({ children }: { children: string }) {
  return (
    <p className="text-destructive mt-2 flex items-start gap-1.5 text-xs" role="alert">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

function actionError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const marker = "Uncaught Error: ";
  const detail = message.includes(marker)
    ? message.slice(message.indexOf(marker) + marker.length).split("\n")[0]
    : "";
  return detail || fallback;
}
