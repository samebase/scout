import { optimisticallySendMessage, useUIMessages } from "@convex-dev/agent/react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircleIcon, PlusIcon, SendIcon, XIcon } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import type { SelectableScoutModel } from "../../convex/scout/models";
import { ScoutRunMessageView, scoutModelLabel } from "#components/scout-run-message";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "#components/ui/message-scroller";
import { Textarea } from "#components/ui/textarea";

type LabSearch = {
  experiment?: string;
  thread?: string;
};

export const Route = createFileRoute("/lab")({
  validateSearch: (search: Record<string, unknown>): LabSearch => ({
    ...(typeof search["experiment"] === "string" ? { experiment: search["experiment"] } : {}),
    ...(typeof search["thread"] === "string" ? { thread: search["thread"] } : {}),
  }),
  head: () => ({
    meta: [{ title: "Scout" }],
  }),
  component: LabPage,
});

type ComposerState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "sending" }
  | { kind: "failed"; message: string };

type LabThread = FunctionReturnType<typeof api.scout.lab.listThreads>["page"][number];
type LabExperiment = FunctionReturnType<typeof api.scout.lab.listExperiments>[number];
type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ExperimentId = LabExperiment["_id"];
type ExperimentStatus = LabExperiment["status"];

type PendingThread = {
  threadId: string;
  experimentId: ExperimentId;
};

type StatusControlState =
  | { kind: "idle" }
  | { kind: "saving"; experimentId: ExperimentId }
  | { kind: "failed"; experimentId: ExperimentId; message: string };

type LabNotice = { kind: "error" | "status"; message: string };

const MODEL_OPTIONS = [
  { value: "openai/gpt-5.6-luna", label: "Luna" },
  { value: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash" },
] satisfies readonly { value: SelectableScoutModel; label: string }[];

const DEFAULT_MODEL: SelectableScoutModel = "openai/gpt-5.6-luna";
const UNGROUPED_SEARCH_VALUE = "ungrouped";
const THREAD_PAGE_SIZE = 50;
const MAX_THREADS_PER_ASSIGNMENT = 50;
const threadDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "short",
});

function LabPage() {
  return (
    <main className="mx-auto flex h-[calc(100dvh-3.25rem)] w-full max-w-4xl flex-col gap-4 px-4 pb-4">
      <AuthLoading>
        <p className="text-muted-foreground py-10 text-sm">Loading...</p>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <AgentLab />
      </Authenticated>
    </main>
  );
}

function threadLabel(thread: LabThread) {
  const title = thread.title?.trim();
  return title || "New thread";
}

function AgentLab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const experiments = useQuery(api.scout.lab.listExperiments, {});
  const threads = usePaginatedQuery(
    api.scout.lab.listThreads,
    {},
    { initialNumItems: THREAD_PAGE_SIZE },
  );
  const scouts = useQuery(api.scout.scouts.list);
  const createThread = useMutation(api.scout.lab.createThread);
  const setExperimentStatus = useMutation(api.scout.lab.setExperimentStatus);
  const sendMessage = useMutation(api.scout.lab.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.scout.lab.listMessages),
  );
  const [selectedModel, setSelectedModel] = useState<SelectableScoutModel>(DEFAULT_MODEL);
  const [draft, setDraft] = useState("");
  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });
  const [pendingThread, setPendingThread] = useState<PendingThread | null>(null);
  const [createExperimentOpen, setCreateExperimentOpen] = useState(false);
  const [createExperimentSubmitting, setCreateExperimentSubmitting] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [statusState, setStatusState] = useState<StatusControlState>({ kind: "idle" });
  const [notice, setNotice] = useState<LabNotice | null>(null);
  const createExperimentButton = useRef<HTMLButtonElement>(null);
  const experimentHeading = useRef<HTMLHeadingElement>(null);
  const assignmentButton = useRef<HTMLButtonElement>(null);
  const experimentToFocus = useRef<ExperimentId | null>(null);
  const availableScouts = scouts ?? [];
  const activeScouts = availableScouts.filter((scout) => scout.status === "active");
  const availableExperiments = experiments ?? [];
  const availableThreads = threads.results;
  const ungroupedThreads = availableThreads.filter((thread) => thread.experimentId === null);
  const requestedExperiment = availableExperiments.find(
    (experiment) => experiment._id === search.experiment,
  );
  const automaticExperiment =
    availableExperiments.find((experiment) => experiment.status === "active") ??
    availableExperiments[0];
  const showingUngrouped =
    search.experiment === UNGROUPED_SEARCH_VALUE ||
    (experiments !== undefined &&
      search.experiment === undefined &&
      requestedExperiment === undefined &&
      automaticExperiment === undefined);
  const selectedExperiment = showingUngrouped
    ? undefined
    : (requestedExperiment ?? (search.experiment === undefined ? automaticExperiment : undefined));
  const visibleThreads = selectedExperiment
    ? availableThreads.filter((thread) => thread.experimentId === selectedExperiment._id)
    : showingUngrouped
      ? ungroupedThreads
      : [];
  const requestedThread = visibleThreads.find((thread) => thread.threadId === search.thread);
  const requestedPendingThread =
    selectedExperiment &&
    pendingThread?.experimentId === selectedExperiment._id &&
    pendingThread.threadId === search.thread
      ? pendingThread
      : null;
  const threadId =
    requestedThread?.threadId ??
    requestedPendingThread?.threadId ??
    (search.thread === undefined ? visibleThreads[0]?.threadId : undefined) ??
    null;
  const selectedThread = availableThreads.find((thread) => thread.threadId === threadId);
  const selectedScoutId = selectedExperiment?.scoutId ?? selectedThread?.scoutId;
  const selectedScout = selectedScoutId
    ? availableScouts.find((scout) => scout._id === selectedScoutId)
    : undefined;
  const selectedActiveScout = selectedScout?.status === "active" ? selectedScout : undefined;
  const scoutActivity = useQuery(
    api.scout.lab.getScoutActivity,
    selectedScoutId ? { scoutId: selectedScoutId } : "skip",
  );
  const messages = useUIMessages(api.scout.lab.listMessages, threadId ? { threadId } : "skip", {
    initialNumItems: 50,
    stream: true,
  });
  const isBusy = composerState.kind === "creating" || composerState.kind === "sending";
  const isActivityLoading = selectedScoutId !== undefined && scoutActivity === undefined;
  const isWorking = isBusy || isActivityLoading || scoutActivity?.active === true;
  const isLoading =
    experiments === undefined || threads.status === "LoadingFirstPage" || scouts === undefined;
  const selectedExperimentIsActive = selectedExperiment?.status === "active";
  const canCreateThread = Boolean(selectedExperimentIsActive && selectedActiveScout && !isWorking);
  const canCompose = Boolean(
    selectedActiveScout &&
    (threadId !== null || (selectedExperimentIsActive && search.thread === undefined)),
  );
  const assignableThreads = selectedExperiment
    ? ungroupedThreads.filter((thread) => thread.scoutId === selectedExperiment.scoutId)
    : [];
  const isLocatingRequestedThread =
    search.thread !== undefined &&
    requestedThread === undefined &&
    requestedPendingThread === null &&
    threads.status !== "Exhausted";
  const selectionMissing =
    (search.experiment !== undefined &&
      search.experiment !== UNGROUPED_SEARCH_VALUE &&
      experiments !== undefined &&
      requestedExperiment === undefined) ||
    (search.thread !== undefined &&
      requestedThread === undefined &&
      requestedPendingThread === null &&
      threads.status === "Exhausted");
  const selectionKey = `${search.experiment ?? ""}:${search.thread ?? ""}`;
  const currentSelectionKey = useRef(selectionKey);
  currentSelectionKey.current = selectionKey;

  useEffect(() => {
    if (experiments === undefined || threads.status === "LoadingFirstPage") {
      return;
    }

    if (search.experiment === undefined) {
      const experiment = automaticExperiment?._id ?? UNGROUPED_SEARCH_VALUE;
      const firstThread = visibleThreads[0]?.threadId;
      void navigate({
        to: "/lab",
        replace: true,
        search: { experiment, ...(firstThread ? { thread: firstThread } : {}) },
      });
      return;
    }

    if (
      search.thread === undefined &&
      (requestedExperiment !== undefined || showingUngrouped) &&
      visibleThreads[0]
    ) {
      void navigate({
        to: "/lab",
        replace: true,
        search: { experiment: search.experiment, thread: visibleThreads[0].threadId },
      });
    }
  }, [
    automaticExperiment?._id,
    experiments,
    navigate,
    requestedExperiment,
    search.experiment,
    search.thread,
    showingUngrouped,
    threads.status,
    visibleThreads,
  ]);

  useEffect(() => {
    if (
      search.thread !== undefined &&
      requestedThread === undefined &&
      requestedPendingThread === null &&
      threads.status === "CanLoadMore"
    ) {
      threads.loadMore(THREAD_PAGE_SIZE);
    }
  }, [requestedPendingThread, requestedThread, search.thread, threads]);

  useEffect(() => {
    setDraft("");
    setComposerState((current) => (current.kind === "failed" ? { kind: "idle" } : current));
    setPendingThread((current) => (current?.threadId === search.thread ? current : null));
    setAssignmentOpen(false);
  }, [search.experiment, search.thread]);

  useEffect(() => {
    if (selectedExperiment?._id !== experimentToFocus.current) {
      return;
    }
    experimentToFocus.current = null;
    requestAnimationFrame(() => experimentHeading.current?.focus());
  }, [selectedExperiment?._id]);

  const resetForNavigation = () => {
    setDraft("");
    setComposerState((current) => (current.kind === "failed" ? { kind: "idle" } : current));
    setPendingThread(null);
    setAssignmentOpen(false);
    setNotice(null);
  };

  const closeCreateExperiment = () => {
    if (createExperimentSubmitting) {
      return;
    }
    setCreateExperimentOpen(false);
    requestAnimationFrame(() => createExperimentButton.current?.focus());
  };

  const onExperimentCreated = (experimentId: ExperimentId, warning?: string) => {
    setCreateExperimentSubmitting(false);
    setCreateExperimentOpen(false);
    experimentToFocus.current = experimentId;
    setNotice(
      warning
        ? { kind: "error", message: warning }
        : { kind: "status", message: "Experiment created." },
    );
    void navigate({
      to: "/lab",
      search: { experiment: experimentId },
    });
  };

  const onNewThread = async () => {
    if (!canCreateThread || !selectedExperiment) {
      return;
    }
    setComposerState({ kind: "creating" });
    setNotice(null);
    const submissionSelectionKey = selectionKey;
    try {
      const created = await createThread({ experimentId: selectedExperiment._id });
      setPendingThread({
        threadId: created.threadId,
        experimentId: selectedExperiment._id,
      });
      await navigate({
        to: "/lab",
        search: { experiment: selectedExperiment._id, thread: created.threadId },
      });
      setComposerState({ kind: "idle" });
    } catch {
      setComposerState(
        currentSelectionKey.current === submissionSelectionKey
          ? { kind: "failed", message: "Could not create a new thread." }
          : { kind: "idle" },
      );
    }
  };

  const submitPrompt = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isWorking || !selectedActiveScout || !canCompose) {
      return;
    }

    setComposerState({ kind: "sending" });
    let activeThreadId = threadId;
    let submissionSelectionKey = selectionKey;
    try {
      if (!activeThreadId) {
        if (!selectedExperiment || selectedExperiment.status !== "active") {
          return;
        }
        const created = await createThread({ experimentId: selectedExperiment._id });
        activeThreadId = created.threadId;
        setPendingThread({
          threadId: created.threadId,
          experimentId: selectedExperiment._id,
        });
        submissionSelectionKey = `${selectedExperiment._id}:${created.threadId}`;
        currentSelectionKey.current = submissionSelectionKey;
        void navigate({
          to: "/lab",
          search: { experiment: selectedExperiment._id, thread: created.threadId },
        });
      }
      setDraft("");
      await sendMessage({
        threadId: activeThreadId,
        prompt,
        model: selectedModel,
      });
      setComposerState({ kind: "idle" });
    } catch {
      if (currentSelectionKey.current === submissionSelectionKey) {
        setDraft(prompt);
        setComposerState({ kind: "failed", message: "Scout could not accept that message." });
      } else {
        setComposerState({ kind: "idle" });
      }
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  const onModelChange = (value: string) => {
    const option = MODEL_OPTIONS.find((candidate) => candidate.value === value);
    if (option) {
      setSelectedModel(option.value);
    }
  };

  const onStatusChange = async (status: ExperimentStatus) => {
    if (!selectedExperiment || selectedExperiment.status === status) {
      return;
    }
    setStatusState({ kind: "saving", experimentId: selectedExperiment._id });
    try {
      await setExperimentStatus({ experimentId: selectedExperiment._id, status });
      setStatusState({ kind: "idle" });
    } catch {
      setStatusState({
        kind: "failed",
        experimentId: selectedExperiment._id,
        message: "Could not change the experiment status.",
      });
    }
  };

  const transcriptIsLoading =
    isLoading ||
    isLocatingRequestedThread ||
    (threadId !== null && messages.status === "LoadingFirstPage");
  const emptyTranscript = emptyTranscriptCopy({
    isLoading: transcriptIsLoading,
    hasThread: threadId !== null,
    selectionMissing,
    selectedExperiment,
    showingUngrouped,
  });

  return (
    <>
      <header className="flex shrink-0 flex-col gap-3 border-b py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Admin agent lab
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-medium tracking-tight">Experiments</h1>
            <span className="bg-emerald-500 size-1.5 rounded-full" aria-hidden="true" />
            <span className="text-muted-foreground text-xs">{scoutModelLabel(selectedModel)}</span>
          </div>
        </div>
        <Button
          ref={createExperimentButton}
          type="button"
          size="sm"
          aria-expanded={createExperimentOpen}
          aria-controls="create-experiment-panel"
          disabled={createExperimentSubmitting || availableScouts.length === 0}
          onClick={() =>
            createExperimentOpen ? closeCreateExperiment() : setCreateExperimentOpen(true)
          }
        >
          {createExperimentOpen ? <XIcon /> : <PlusIcon />}
          {createExperimentOpen ? "Close" : "New experiment"}
        </Button>
      </header>

      {createExperimentOpen ? (
        <ExperimentForm
          scouts={availableScouts}
          ungroupedThreads={ungroupedThreads}
          onCancel={closeCreateExperiment}
          onCreated={onExperimentCreated}
          onSubmittingChange={setCreateExperimentSubmitting}
        />
      ) : (
        <section
          className="bg-card grid min-h-0 flex-1 overflow-hidden rounded-xl border lg:grid-cols-[17rem_minmax(0,1fr)]"
          aria-label="Scout Lab workspace"
        >
          <LabNavigation
            experiments={experiments}
            threads={threads.status === "LoadingFirstPage" ? undefined : availableThreads}
            canLoadMore={threads.status === "CanLoadMore"}
            isLoadingMore={threads.status === "LoadingMore"}
            selectedExperimentId={selectedExperiment?._id}
            selectedThreadId={threadId}
            showingUngrouped={showingUngrouped}
            onLoadMore={() => threads.loadMore(THREAD_PAGE_SIZE)}
            onNavigate={resetForNavigation}
          />
          <div className="flex min-h-0 min-w-0 flex-col">
            <ExperimentContextHeader
              headingRef={experimentHeading}
              assignmentButtonRef={assignmentButton}
              experiment={selectedExperiment}
              scout={selectedScout}
              showingUngrouped={showingUngrouped}
              isLoading={isLoading}
              canCreateThread={canCreateThread}
              isCreatingThread={composerState.kind === "creating"}
              assignableThreadCount={assignableThreads.length}
              assignmentOpen={assignmentOpen}
              statusState={statusState}
              onNewThread={() => void onNewThread()}
              onStatusChange={(status) => void onStatusChange(status)}
              onToggleAssignment={() => setAssignmentOpen((open) => !open)}
            />
            {notice ? (
              <p
                className={`border-b px-4 py-2 text-sm ${
                  notice.kind === "error" ? "text-destructive" : "text-muted-foreground"
                }`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.message}
              </p>
            ) : null}
            {assignmentOpen && selectedExperiment ? (
              <AssignThreadsPanel
                key={selectedExperiment._id}
                experiment={selectedExperiment}
                threads={assignableThreads}
                onAssigned={() => {
                  setAssignmentOpen(false);
                  setNotice({ kind: "status", message: "Threads added to experiment." });
                  requestAnimationFrame(() => experimentHeading.current?.focus());
                }}
                onCancel={() => {
                  setAssignmentOpen(false);
                  requestAnimationFrame(() => assignmentButton.current?.focus());
                }}
              />
            ) : (
              <>
                <div className="min-h-0 flex-1">
                  <MessageScrollerProvider autoScroll scrollPreviousItemPeek={48}>
                    <MessageScroller>
                      <MessageScrollerViewport>
                        <MessageScrollerContent className="px-4 py-6 sm:px-6" aria-busy={isWorking}>
                          {messages.status === "CanLoadMore" ? (
                            <MessageScrollerItem>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mx-auto"
                                onClick={() => messages.loadMore(THREAD_PAGE_SIZE)}
                              >
                                Load earlier messages
                              </Button>
                            </MessageScrollerItem>
                          ) : null}
                          {messages.results.length === 0 ? (
                            <EmptyTranscript
                              title={emptyTranscript.title}
                              description={emptyTranscript.description}
                            />
                          ) : null}
                          {messages.results.map((message) => (
                            <MessageScrollerItem
                              key={message.key}
                              messageId={message.id}
                              scrollAnchor={message.role === "user"}
                            >
                              <ScoutRunMessageView message={message} />
                            </MessageScrollerItem>
                          ))}
                        </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton />
                    </MessageScroller>
                  </MessageScrollerProvider>
                </div>

                <form
                  className="border-t p-3 sm:p-4"
                  onSubmit={(event) => void submitPrompt(event)}
                >
                  {selectedScout && !selectedActiveScout ? (
                    <p className="text-muted-foreground mb-2 text-sm">
                      Activate {selectedScout.displayName} to continue this thread.
                    </p>
                  ) : activeScouts.length === 0 && scouts !== undefined ? (
                    <p className="text-muted-foreground mb-2 text-sm">
                      Register an active scout before starting a thread.{" "}
                      <Link to="/scouts" className="text-foreground underline underline-offset-4">
                        Register a scout
                      </Link>
                    </p>
                  ) : selectedExperiment?.status === "completed" && threadId === null ? (
                    <p className="text-muted-foreground mb-2 text-sm">
                      Set this experiment to Active before starting a thread.
                    </p>
                  ) : !selectedExperiment && threadId === null && !isLoading ? (
                    <p className="text-muted-foreground mb-2 text-sm">
                      Create an experiment before starting a thread.
                    </p>
                  ) : null}
                  <div className="focus-within:border-ring focus-within:ring-ring/30 rounded-xl border bg-background p-2 transition-shadow focus-within:ring-3">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={onComposerKeyDown}
                      placeholder={
                        canCompose && selectedActiveScout
                          ? `Ask ${selectedActiveScout.displayName} to inspect, research, or explain...`
                          : "Choose an active experiment or saved thread."
                      }
                      aria-label="Message Scout"
                      rows={2}
                      disabled={isWorking || !canCompose}
                      className="max-h-40 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                    <div className="flex items-center justify-between gap-3 px-1 pt-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <label className="text-muted-foreground text-xs" htmlFor="lab-model">
                          Model
                        </label>
                        <select
                          id="lab-model"
                          value={selectedModel}
                          disabled={isWorking}
                          onChange={(event) => onModelChange(event.currentTarget.value)}
                          className="border-input bg-background h-8 min-w-0 rounded-md border px-2 text-xs"
                        >
                          {MODEL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-muted-foreground hidden text-xs sm:block">
                          Enter to send. Shift+Enter for a new line.
                        </p>
                        <Button
                          type="submit"
                          size="icon-sm"
                          disabled={isWorking || !canCompose || !draft.trim()}
                          aria-label="Send message"
                        >
                          {composerState.kind === "sending" ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : (
                            <SendIcon />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {composerState.kind === "failed" ? (
                    <p className="text-destructive mt-2 text-sm" role="alert">
                      {composerState.message}
                    </p>
                  ) : null}
                </form>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function LabNavigation({
  experiments,
  threads,
  canLoadMore,
  isLoadingMore,
  selectedExperimentId,
  selectedThreadId,
  showingUngrouped,
  onLoadMore,
  onNavigate,
}: {
  experiments: readonly LabExperiment[] | undefined;
  threads: readonly LabThread[] | undefined;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  selectedExperimentId: ExperimentId | undefined;
  selectedThreadId: string | null;
  showingUngrouped: boolean;
  onLoadMore: () => void;
  onNavigate: () => void;
}) {
  if (experiments === undefined || threads === undefined) {
    return (
      <nav
        className="text-muted-foreground max-h-28 overflow-y-auto border-b p-4 text-sm lg:max-h-none lg:border-r lg:border-b-0"
        aria-label="Lab experiments"
        aria-busy="true"
      >
        Loading experiments...
      </nav>
    );
  }

  const ungroupedThreads = threads.filter((thread) => thread.experimentId === null);

  return (
    <nav
      className="max-h-28 overflow-y-auto border-b lg:max-h-none lg:border-r lg:border-b-0"
      aria-label="Lab experiments"
    >
      <ul className="divide-y">
        {experiments.map((experiment) => {
          const experimentThreads = threads.filter(
            (thread) => thread.experimentId === experiment._id,
          );
          const selected = experiment._id === selectedExperimentId;
          return (
            <li key={experiment._id} className={selected ? "bg-muted/30" : undefined}>
              <Link
                to="/lab"
                search={{ experiment: experiment._id }}
                aria-current={selected ? "location" : undefined}
                onClick={onNavigate}
                className="group block px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 wrap-break-word text-sm font-medium group-hover:underline group-hover:underline-offset-4">
                    {experiment.name}
                  </span>
                  <ExperimentStatusText status={experiment.status} />
                </span>
              </Link>
              {experimentThreads.length > 0 ? (
                <ul
                  className="border-t border-dashed py-1"
                  aria-label={`${experiment.name} threads`}
                >
                  {experimentThreads.map((thread) => (
                    <ThreadNavigationLink
                      key={thread.threadId}
                      experimentSearch={experiment._id}
                      thread={thread}
                      selected={thread.threadId === selectedThreadId}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              ) : selected ? (
                <p className="text-muted-foreground border-t border-dashed px-4 py-2 text-xs">
                  No threads yet
                </p>
              ) : null}
            </li>
          );
        })}
        <li className={showingUngrouped ? "bg-muted/30" : undefined}>
          <Link
            to="/lab"
            search={{ experiment: UNGROUPED_SEARCH_VALUE }}
            aria-current={showingUngrouped ? "location" : undefined}
            onClick={onNavigate}
            className="group block px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            <span className="text-sm font-medium group-hover:underline group-hover:underline-offset-4">
              Ungrouped history
            </span>
          </Link>
          {ungroupedThreads.length > 0 ? (
            <ul className="border-t border-dashed py-1" aria-label="Ungrouped threads">
              {ungroupedThreads.map((thread) => (
                <ThreadNavigationLink
                  key={thread.threadId}
                  experimentSearch={UNGROUPED_SEARCH_VALUE}
                  thread={thread}
                  selected={showingUngrouped && thread.threadId === selectedThreadId}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          ) : showingUngrouped ? (
            <p className="text-muted-foreground border-t border-dashed px-4 py-2 text-xs">
              No ungrouped threads
            </p>
          ) : null}
        </li>
      </ul>
      {canLoadMore || isLoadingMore ? (
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
            {isLoadingMore ? "Loading history" : "Load older threads"}
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

function ThreadNavigationLink({
  experimentSearch,
  thread,
  selected,
  onNavigate,
}: {
  experimentSearch: string;
  thread: LabThread;
  selected: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        to="/lab"
        search={{ experiment: experimentSearch, thread: thread.threadId }}
        aria-current={selected ? "page" : undefined}
        onClick={onNavigate}
        className={`block px-4 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 ${
          selected ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="block wrap-break-word text-xs leading-snug">{threadLabel(thread)}</span>
        <time
          className="mt-0.5 block font-mono text-[0.625rem]"
          dateTime={new Date(thread.creationTime).toISOString()}
        >
          {threadDate.format(thread.creationTime)}
        </time>
      </Link>
    </li>
  );
}

function ExperimentContextHeader({
  headingRef,
  assignmentButtonRef,
  experiment,
  scout,
  showingUngrouped,
  isLoading,
  canCreateThread,
  isCreatingThread,
  assignableThreadCount,
  assignmentOpen,
  statusState,
  onNewThread,
  onStatusChange,
  onToggleAssignment,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  assignmentButtonRef: RefObject<HTMLButtonElement | null>;
  experiment: LabExperiment | undefined;
  scout: Scout | undefined;
  showingUngrouped: boolean;
  isLoading: boolean;
  canCreateThread: boolean;
  isCreatingThread: boolean;
  assignableThreadCount: number;
  assignmentOpen: boolean;
  statusState: StatusControlState;
  onNewThread: () => void;
  onStatusChange: (status: ExperimentStatus) => void;
  onToggleAssignment: () => void;
}) {
  if (isLoading) {
    return <p className="text-muted-foreground border-b px-4 py-3 text-sm">Loading context...</p>;
  }

  if (!experiment) {
    return (
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">{showingUngrouped ? "Ungrouped history" : "No experiment"}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {showingUngrouped
            ? "Create an experiment to group these saved threads."
            : "Create an experiment to start a product test."}
        </p>
        {scout ? (
          <p className="text-muted-foreground mt-2 text-xs">Scout: {scout.displayName}</p>
        ) : null}
      </div>
    );
  }

  const statusSaving = statusState.kind === "saving" && statusState.experimentId === experiment._id;
  const statusFailure =
    statusState.kind === "failed" && statusState.experimentId === experiment._id
      ? statusState.message
      : null;

  return (
    <div className="max-h-36 overflow-y-auto border-b px-4 py-3 lg:max-h-48">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 ref={headingRef} tabIndex={-1} className="wrap-break-word font-medium outline-none">
            {experiment.name}
          </h2>
          <p className="text-muted-foreground mt-1 wrap-break-word text-sm whitespace-pre-wrap">
            {experiment.objective}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status</span>
            <select
              value={experiment.status}
              disabled={statusSaving}
              onChange={(event) => {
                const status = event.currentTarget.value;
                if (status === "active" || status === "completed") {
                  onStatusChange(status);
                }
              }}
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          {assignableThreadCount > 0 ? (
            <Button
              ref={assignmentButtonRef}
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={assignmentOpen}
              aria-controls="assign-threads-panel"
              onClick={onToggleAssignment}
            >
              {assignmentOpen ? "Close history" : "Add history"}
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!canCreateThread} onClick={onNewThread}>
            {isCreatingThread ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            New thread
          </Button>
        </div>
      </div>
      <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div className="flex min-w-0 gap-1.5">
          <dt>Scout</dt>
          <dd className="text-foreground wrap-break-word">{scout?.displayName ?? "Unavailable"}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt>Target</dt>
          <dd className="text-foreground wrap-break-word">
            {experiment.targetProduct} · {experiment.targetDomain}
          </dd>
        </div>
      </dl>
      {statusFailure ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {statusFailure}
        </p>
      ) : null}
    </div>
  );
}

type ExperimentFields = {
  name: string;
  scoutId: string;
  targetProduct: string;
  targetDomain: string;
  objective: string;
};

type ExperimentFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

const EMPTY_EXPERIMENT_FIELDS: ExperimentFields = {
  name: "",
  scoutId: "",
  targetProduct: "",
  targetDomain: "",
  objective: "",
};

function ExperimentForm({
  scouts,
  ungroupedThreads,
  onCancel,
  onCreated,
  onSubmittingChange,
}: {
  scouts: readonly Scout[];
  ungroupedThreads: readonly LabThread[];
  onCancel: () => void;
  onCreated: (experimentId: ExperimentId, warning?: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const createExperiment = useMutation(api.scout.lab.createExperiment);
  const assignThreads = useMutation(api.scout.lab.assignThreads);
  const [fields, setFields] = useState<ExperimentFields>(EMPTY_EXPERIMENT_FIELDS);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [state, setState] = useState<ExperimentFormState>({ kind: "idle" });
  const submitting = state.kind === "submitting";
  const selectedScout = scouts.find((scout) => scout._id === fields.scoutId);
  const matchingThreads = selectedScout
    ? ungroupedThreads.filter((thread) => thread.scoutId === selectedScout._id)
    : [];

  const updateField = <Key extends keyof ExperimentFields>(
    key: Key,
    value: ExperimentFields[Key],
  ) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (state.kind === "failed") {
      setState({ kind: "idle" });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !selectedScout) {
      return;
    }
    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      const created = await createExperiment({
        name: fields.name,
        scoutId: selectedScout._id,
        targetProduct: fields.targetProduct,
        targetDomain: fields.targetDomain,
        objective: fields.objective,
      });
      if (selectedThreadIds.length > 0) {
        try {
          await assignThreads({
            experimentId: created.experimentId,
            threadIds: selectedThreadIds,
          });
        } catch {
          onCreated(
            created.experimentId,
            "Experiment created, but its selected history was not added. Use Add history to retry.",
          );
          return;
        }
      }
      onCreated(created.experimentId);
    } catch (error) {
      onSubmittingChange(false);
      setState({ kind: "failed", message: experimentFormError(error) });
    }
  };

  return (
    <section
      id="create-experiment-panel"
      className="bg-card min-h-0 flex-1 overflow-y-auto rounded-xl border p-4 sm:p-5"
      aria-labelledby="create-experiment-heading"
    >
      <h2 id="create-experiment-heading" className="text-lg font-medium">
        New experiment
      </h2>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <FormField label="Name" htmlFor="experiment-name">
          <Input
            id="experiment-name"
            name="name"
            value={fields.name}
            autoComplete="off"
            placeholder="Tally form lifecycle"
            autoFocus
            required
            maxLength={120}
            disabled={submitting}
            onChange={(event) => updateField("name", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Scout" htmlFor="experiment-scout">
          <select
            id="experiment-scout"
            name="scoutId"
            value={fields.scoutId}
            required
            disabled={submitting}
            onChange={(event) => {
              updateField("scoutId", event.currentTarget.value);
              setSelectedThreadIds([]);
            }}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Choose a Scout</option>
            {scouts.map((scout) => (
              <option key={scout._id} value={scout._id}>
                {scout.displayName} /{scout.slug}
                {scout.status === "disabled" ? " (disabled)" : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Target product" htmlFor="experiment-product">
          <Input
            id="experiment-product"
            name="targetProduct"
            value={fields.targetProduct}
            autoComplete="off"
            placeholder="Tally"
            required
            maxLength={120}
            disabled={submitting}
            onChange={(event) => updateField("targetProduct", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Target domain" htmlFor="experiment-domain">
          <Input
            id="experiment-domain"
            name="targetDomain"
            value={fields.targetDomain}
            autoComplete="url"
            inputMode="url"
            placeholder="tally.so"
            required
            maxLength={261}
            disabled={submitting}
            onChange={(event) => updateField("targetDomain", event.currentTarget.value)}
          />
        </FormField>
        <FormField
          label="Objective or claim"
          htmlFor="experiment-objective"
          className="sm:col-span-2"
        >
          <Textarea
            id="experiment-objective"
            name="objective"
            value={fields.objective}
            placeholder="Create, publish, submit, and verify one complete form lifecycle."
            required
            maxLength={2000}
            rows={4}
            disabled={submitting}
            onChange={(event) => updateField("objective", event.currentTarget.value)}
          />
        </FormField>
        <div className="sm:col-span-2">
          <ThreadChecklist
            legend="Ungrouped history"
            threads={matchingThreads}
            selectedThreadIds={selectedThreadIds}
            disabled={submitting || !selectedScout}
            emptyMessage={
              selectedScout
                ? `No ungrouped threads use ${selectedScout.displayName}.`
                : "Choose a Scout to see matching history."
            }
            onChange={setSelectedThreadIds}
          />
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !selectedScout}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Creating" : "Create experiment"}
          </Button>
        </div>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function AssignThreadsPanel({
  experiment,
  threads,
  onAssigned,
  onCancel,
}: {
  experiment: LabExperiment;
  threads: readonly LabThread[];
  onAssigned: () => void;
  onCancel: () => void;
}) {
  const assignThreads = useMutation(api.scout.lab.assignThreads);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [state, setState] = useState<ExperimentFormState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || selectedThreadIds.length === 0) {
      return;
    }
    setState({ kind: "submitting" });
    try {
      await assignThreads({ experimentId: experiment._id, threadIds: selectedThreadIds });
      onAssigned();
    } catch {
      setState({ kind: "failed", message: "Could not add the selected threads." });
    }
  };

  return (
    <form
      id="assign-threads-panel"
      className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-3"
      onSubmit={(event) => void submit(event)}
    >
      <ThreadChecklist
        legend={`Add history to ${experiment.name}`}
        threads={threads}
        selectedThreadIds={selectedThreadIds}
        disabled={submitting}
        emptyMessage="No matching ungrouped threads remain."
        onChange={setSelectedThreadIds}
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting || selectedThreadIds.length === 0}>
          {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
          {submitting ? "Adding" : "Add selected"}
        </Button>
      </div>
      {state.kind === "failed" ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ThreadChecklist({
  legend,
  threads,
  selectedThreadIds,
  disabled,
  emptyMessage,
  onChange,
}: {
  legend: string;
  threads: readonly LabThread[];
  selectedThreadIds: readonly string[];
  disabled: boolean;
  emptyMessage: string;
  onChange: (threadIds: string[]) => void;
}) {
  const allSelected =
    threads.length > 0 &&
    threads
      .slice(0, MAX_THREADS_PER_ASSIGNMENT)
      .every((thread) => selectedThreadIds.includes(thread.threadId));
  const selectionLimitReached = selectedThreadIds.length >= MAX_THREADS_PER_ASSIGNMENT;

  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex justify-end">
        {threads.length > 0 ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() =>
              onChange(
                allSelected
                  ? []
                  : threads.slice(0, MAX_THREADS_PER_ASSIGNMENT).map((thread) => thread.threadId),
              )
            }
          >
            {allSelected ? "Clear" : `Select up to ${MAX_THREADS_PER_ASSIGNMENT}`}
          </Button>
        ) : null}
      </div>
      {threads.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label={legend}>
          {threads.map((thread) => {
            const checked = selectedThreadIds.includes(thread.threadId);
            return (
              <li key={thread.threadId}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selectionLimitReached}
                    onChange={() =>
                      onChange(
                        checked
                          ? selectedThreadIds.filter((threadId) => threadId !== thread.threadId)
                          : [...selectedThreadIds, thread.threadId],
                      )
                    }
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block wrap-break-word text-sm">{threadLabel(thread)}</span>
                    <time
                      className="text-muted-foreground mt-0.5 block font-mono text-[0.625rem]"
                      dateTime={new Date(thread.creationTime).toISOString()}
                    >
                      {threadDate.format(thread.creationTime)}
                    </time>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

function FormField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ExperimentStatusText({ status }: { status: ExperimentStatus }) {
  const dotClass = status === "active" ? "bg-emerald-500" : "bg-muted-foreground";
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-[0.625rem]">
      <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {status === "active" ? "Active" : "Completed"}
    </span>
  );
}

function experimentFormError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const knownMessages = [
    "Target domain must be a valid hostname or URL",
    "Target domain must use HTTP or HTTPS",
    "Experiment name cannot be empty",
    "Target product cannot be empty",
    "Objective cannot be empty",
  ] as const;
  return (
    knownMessages.find((known) => message.includes(known)) ?? "Could not create the experiment."
  );
}

function emptyTranscriptCopy({
  isLoading,
  hasThread,
  selectionMissing,
  selectedExperiment,
  showingUngrouped,
}: {
  isLoading: boolean;
  hasThread: boolean;
  selectionMissing: boolean;
  selectedExperiment: LabExperiment | undefined;
  showingUngrouped: boolean;
}) {
  if (isLoading) {
    return {
      title: "Opening the thread",
      description: "The saved conversation will appear here.",
    };
  }
  if (hasThread) {
    return {
      title: "Empty thread",
      description: "Send a message to start this technical attempt.",
    };
  }
  if (selectionMissing) {
    return {
      title: "Selection not available",
      description: "Choose another experiment or thread from the Lab history.",
    };
  }
  if (selectedExperiment?.status === "active") {
    return {
      title: "Start a thread",
      description: "Send a message or use New thread to begin a technical attempt.",
    };
  }
  if (selectedExperiment) {
    return {
      title: "No threads in this experiment",
      description: "Set the experiment to Active to start one.",
    };
  }
  if (showingUngrouped) {
    return {
      title: "No ungrouped thread selected",
      description: "Choose saved history or create an experiment.",
    };
  }
  return {
    title: "Create an experiment",
    description: "Group one product test before starting technical threads.",
  };
}

function EmptyTranscript({ title, description }: { title: string; description: string }) {
  return (
    <MessageScrollerItem className="my-auto">
      <div className="mx-auto max-w-sm py-12 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </MessageScrollerItem>
  );
}
