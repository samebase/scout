import { optimisticallySendMessage, useUIMessages } from "@convex-dev/agent/react";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendIcon,
  WrenchIcon,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { SelectableScoutModel } from "../../convex/scout/models";
import { Bubble, BubbleContent } from "#components/ui/bubble";
import { Button } from "#components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "#components/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "#components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "#components/ui/message-scroller";
import { Textarea } from "#components/ui/textarea";

export const Route = createFileRoute("/lab")({
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

type ToolSnapshot = {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

type LabThread = FunctionReturnType<typeof api.scout.lab.listThreads>[number];
type LabMessage = FunctionReturnType<typeof api.scout.lab.listMessages>["page"][number];
type LabMessageMetadata = NonNullable<LabMessage["metadata"]>;
type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ScoutId = Scout["_id"];

type LabSelection =
  | { kind: "automatic" }
  | { kind: "scout"; scoutId: ScoutId }
  | { kind: "thread"; threadId: string }
  | { kind: "pendingThread"; threadId: string; scoutId: ScoutId };

const MODEL_OPTIONS = [
  { value: "openai/gpt-5.6-luna", label: "Luna" },
  { value: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash" },
] satisfies readonly { value: SelectableScoutModel; label: string }[];

const DEFAULT_MODEL: SelectableScoutModel = "openai/gpt-5.6-luna";
const tokenNumber = new Intl.NumberFormat();
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

function modelLabel(model: string) {
  return MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}

function threadLabel(thread: LabThread) {
  const title = thread.title?.trim();
  return title || "New thread";
}

function AgentLab() {
  const threads = useQuery(api.scout.lab.listThreads);
  const scouts = useQuery(api.scout.scouts.list);
  const createThread = useMutation(api.scout.lab.createThread);
  const sendMessage = useMutation(api.scout.lab.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.scout.lab.listMessages),
  );
  const [selection, setSelection] = useState<LabSelection>({ kind: "automatic" });
  const [selectedModel, setSelectedModel] = useState<SelectableScoutModel>(DEFAULT_MODEL);
  const [draft, setDraft] = useState("");
  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });
  const availableScouts = scouts ?? [];
  const activeScouts = availableScouts.filter((scout) => scout.status === "active");
  const automaticScout = activeScouts[0];
  const automaticThread = threads?.[0];
  const selectedThreadId =
    selection.kind === "automatic"
      ? automaticThread?.threadId
      : selection.kind === "scout"
        ? threads?.find((thread) => thread.scoutId === selection.scoutId)?.threadId
        : selection.threadId;
  const threadId = selectedThreadId ?? null;
  const selectedThread = threads?.find((thread) => thread.threadId === threadId);
  const selectedScoutId =
    selectedThread?.scoutId ??
    (selection.kind === "scout" || selection.kind === "pendingThread"
      ? selection.scoutId
      : selection.kind === "automatic" && !selectedThread
        ? automaticScout?._id
        : undefined);
  const selectedScout = selectedScoutId
    ? availableScouts.find((scout) => scout._id === selectedScoutId)
    : undefined;
  const selectedActiveScout = selectedScout?.status === "active" ? selectedScout : undefined;
  const scoutActivity = useQuery(
    api.scout.lab.getScoutActivity,
    selectedScoutId ? { scoutId: selectedScoutId } : "skip",
  );
  const visibleThreads = selectedScoutId
    ? (threads?.filter((thread) => thread.scoutId === selectedScoutId) ?? [])
    : [];
  const messages = useUIMessages(api.scout.lab.listMessages, threadId ? { threadId } : "skip", {
    initialNumItems: 50,
    stream: true,
  });
  const isBusy = composerState.kind === "creating" || composerState.kind === "sending";
  const isActivityLoading = selectedScoutId !== undefined && scoutActivity === undefined;
  const isWorking = isBusy || isActivityLoading || scoutActivity?.active === true;
  const isSelectionLocked = isWorking;
  const isLoading = threads === undefined || scouts === undefined;

  const onNewThread = async () => {
    if (isSelectionLocked || !selectedActiveScout) {
      return;
    }
    setComposerState({ kind: "creating" });
    try {
      const created = await createThread({ scoutId: selectedActiveScout._id });
      setSelection({
        kind: "pendingThread",
        threadId: created.threadId,
        scoutId: selectedActiveScout._id,
      });
      setComposerState({ kind: "idle" });
    } catch {
      setComposerState({ kind: "failed", message: "Could not create a new thread." });
    }
  };

  const submitPrompt = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isWorking || !selectedActiveScout) {
      return;
    }

    setComposerState({ kind: "sending" });
    let activeThreadId = threadId;
    try {
      if (!activeThreadId) {
        const created = await createThread({ scoutId: selectedActiveScout._id });
        activeThreadId = created.threadId;
        setSelection({
          kind: "pendingThread",
          threadId: created.threadId,
          scoutId: selectedActiveScout._id,
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
      setDraft(prompt);
      setComposerState({ kind: "failed", message: "Scout could not accept that message." });
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

  const onScoutChange = (value: string) => {
    setDraft("");
    setComposerState({ kind: "idle" });
    const scout = activeScouts.find((candidate) => candidate._id === value);
    if (scout) {
      setSelection({ kind: "scout", scoutId: scout._id });
    }
  };

  const onThreadChange = (value: string) => {
    setDraft("");
    setComposerState({ kind: "idle" });
    const thread = threads?.find((candidate) => candidate.threadId === value);
    if (thread) {
      setSelection({ kind: "thread", threadId: thread.threadId });
    }
  };

  const selectedThreadIsListed = visibleThreads.some((thread) => thread.threadId === threadId);

  return (
    <>
      <header className="flex items-end justify-between gap-4 border-b py-4">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Admin agent lab
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-medium tracking-tight">Scout</h1>
            <span className="bg-emerald-500 size-1.5 rounded-full" aria-hidden="true" />
            <span className="text-muted-foreground text-xs">{modelLabel(selectedModel)}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSelectionLocked || !selectedActiveScout}
          onClick={() => void onNewThread()}
        >
          {composerState.kind === "creating" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <PlusIcon />
          )}
          New thread
        </Button>
      </header>

      <section
        className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
        aria-label="Scout conversation"
      >
        <div className="flex items-start justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <label className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs">Scout</span>
              <select
                value={selectedScoutId ?? ""}
                disabled={isLoading || isSelectionLocked || activeScouts.length === 0}
                onChange={(event) => onScoutChange(event.currentTarget.value)}
                className="border-input bg-background h-8 min-w-0 rounded-md border px-2 text-xs sm:w-48"
              >
                {!selectedScoutId ? <option value="">No active Scouts</option> : null}
                {activeScouts.map((scout) => (
                  <option key={scout._id} value={scout._id}>
                    {scout.displayName} /{scout.slug}
                  </option>
                ))}
                {selectedScout && selectedScout.status !== "active" ? (
                  <option value={selectedScout._id} disabled>
                    {selectedScout.displayName} /{selectedScout.slug} (disabled)
                  </option>
                ) : null}
              </select>
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs">Thread</span>
              <select
                value={threadId ?? ""}
                disabled={
                  isLoading ||
                  isSelectionLocked ||
                  (visibleThreads.length === 0 && threadId === null)
                }
                onChange={(event) => onThreadChange(event.currentTarget.value)}
                className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-xs"
              >
                {threadId !== null && !selectedThreadIsListed ? (
                  <option value={threadId}>
                    {selectedScout?.displayName ?? "Selected Scout"} · New thread
                  </option>
                ) : null}
                {threadId === null ? <option value="">No thread yet</option> : null}
                {visibleThreads.map((thread) => (
                  <option key={thread.threadId} value={thread.threadId}>
                    {threadLabel(thread)} · {threadDate.format(thread.creationTime)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="hidden font-mono text-[0.6875rem] text-muted-foreground sm:inline">
            {threadId ? `thread ${threadId.slice(0, 12)}` : "no thread yet"}
          </span>
        </div>
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
                        onClick={() => messages.loadMore(50)}
                      >
                        Load earlier messages
                      </Button>
                    </MessageScrollerItem>
                  ) : null}
                  {messages.results.length === 0 ? <EmptyTranscript isLoading={isLoading} /> : null}
                  {messages.results.map((message) => (
                    <MessageScrollerItem
                      key={message.key}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <LabMessage message={message} />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>

        <form className="border-t p-3 sm:p-4" onSubmit={(event) => void submitPrompt(event)}>
          {activeScouts.length === 0 && scouts !== undefined ? (
            <p className="text-muted-foreground mb-2 text-sm">
              Register an active scout before starting a thread.{" "}
              <Link to="/scouts" className="text-foreground underline underline-offset-4">
                Register a scout
              </Link>
            </p>
          ) : !selectedActiveScout && scouts !== undefined ? (
            <p className="text-muted-foreground mb-2 text-sm">
              Choose an active Scout to start or continue a thread.
            </p>
          ) : null}
          <div className="focus-within:border-ring focus-within:ring-ring/30 rounded-xl border bg-background p-2 transition-shadow focus-within:ring-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                selectedActiveScout
                  ? `Ask ${selectedActiveScout.displayName} to inspect, research, or explain...`
                  : "Choose an active Scout to start a task."
              }
              aria-label="Message Scout"
              rows={2}
              disabled={isWorking || !selectedActiveScout}
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
                  disabled={isWorking || !selectedActiveScout || !draft.trim()}
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
      </section>
    </>
  );
}

function EmptyTranscript({ isLoading }: { isLoading: boolean }) {
  return (
    <MessageScrollerItem className="my-auto">
      <div className="mx-auto max-w-sm py-12 text-center">
        <p className="text-sm font-medium">
          {isLoading ? "Opening the latest thread" : "Start a Scout task"}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {isLoading
            ? "The saved conversation will appear here."
            : "Messages persist here, including tool activity and provider results."}
        </p>
      </div>
    </MessageScrollerItem>
  );
}

function LabMessage({ message }: { message: LabMessage }) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.role === "system" ? "System" : "Scout";
  const metadata = message.metadata;

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{label}</MessageHeader>
        {message.parts.map((part, index) => (
          <MessagePart key={partKey(part, index)} part={part} role={message.role} />
        ))}
        {message.status === "failed" ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed.</MarkerContent>
          </Marker>
        ) : metadata?.failure ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed: {metadata.failure}</MarkerContent>
          </Marker>
        ) : null}
        {!metadata?.failure && (message.status === "pending" || message.status === "streaming") ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Scout is working
          </MessageFooter>
        ) : metadata ? (
          <MessageFooter>{formatRunMetadata(metadata)}</MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function formatRunMetadata(metadata: LabMessageMetadata) {
  const parts: string[] = [];
  if (metadata.scout?.displayName) parts.push(metadata.scout.displayName);
  if (metadata.model) parts.push(modelLabel(metadata.model));
  if (metadata.usage?.promptTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.promptTokens)} input`);
  }
  if (metadata.usage?.completionTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.completionTokens)} output`);
  }
  if (
    metadata.usage?.promptTokens === undefined &&
    metadata.usage?.completionTokens === undefined &&
    metadata.usage?.totalTokens !== undefined
  ) {
    parts.push(`${tokenNumber.format(metadata.usage.totalTokens)} tokens`);
  }
  if (metadata.durationMs !== undefined) {
    parts.push(formatDuration(metadata.durationMs));
  }
  if (metadata.firecrawlCredits !== undefined) {
    parts.push(`${tokenNumber.format(metadata.firecrawlCredits)} Firecrawl credits`);
  }
  if (metadata.firecrawlDurationMs !== undefined) {
    parts.push(`${formatDuration(metadata.firecrawlDurationMs)} browser`);
  }
  return parts.join(" · ");
}

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function MessagePart({ part, role }: { part: unknown; role: LabMessage["role"] }) {
  const record = asRecord(part);
  const rawType = record ? field(record, "type") : undefined;
  const type = typeof rawType === "string" ? rawType : "unknown";
  const text = record ? field(record, "text") : undefined;

  if (type === "text" && typeof text === "string") {
    if (!text) {
      return null;
    }
    return (
      <Bubble
        variant={role === "user" ? "default" : role === "system" ? "secondary" : "ghost"}
        align={role === "user" ? "end" : "start"}
      >
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    );
  }

  const tool = toolSnapshot(record, type);
  if (tool) {
    return <ToolActivity tool={tool} />;
  }

  if (type === "step-start") {
    return null;
  }

  if (type === "reasoning" && typeof text === "string") {
    return (
      <Collapsible className="text-muted-foreground text-xs">
        <CollapsibleTrigger className="hover:text-foreground flex items-center gap-1 py-1">
          <ChevronRightIcon className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
          Reasoning
        </CollapsibleTrigger>
        <CollapsibleContent className="border-l pl-4 whitespace-pre-wrap">
          {text}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const url = record ? field(record, "url") : undefined;
  if (record && type === "source-url" && typeof url === "string") {
    const rawTitle = field(record, "title");
    const title = typeof rawTitle === "string" ? rawTitle : url;
    return (
      <Marker>
        <MarkerContent>
          Source:{" "}
          <a href={url} target="_blank" rel="noreferrer">
            {title}
          </a>
        </MarkerContent>
      </Marker>
    );
  }

  return (
    <Marker>
      <MarkerContent>
        {type === "unknown" ? "Unrecognized message part" : type.replaceAll("-", " ")}
      </MarkerContent>
    </Marker>
  );
}

function ToolActivity({ tool }: { tool: ToolSnapshot }) {
  const isError = tool.state.includes("error") || tool.error !== undefined;
  const isComplete = tool.state === "output-available";

  return (
    <Collapsible className="bg-muted/40 rounded-lg border px-3 py-2">
      <CollapsibleTrigger className="group/tool flex w-full items-center gap-2 text-left">
        <Marker className={isError ? "text-destructive" : "text-foreground"}>
          <MarkerIcon>
            {isError ? <CircleAlertIcon /> : isComplete ? <CheckCircle2Icon /> : <WrenchIcon />}
          </MarkerIcon>
          <MarkerContent className="flex flex-1 items-baseline justify-between gap-3">
            <span className="font-mono text-xs">{tool.name}</span>
            <span className="text-muted-foreground text-[0.6875rem]">
              {tool.state.replaceAll("-", " ")}
            </span>
          </MarkerContent>
        </Marker>
        <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <dl className="grid gap-3 border-t pt-3">
          {tool.input !== undefined ? <ToolValue label="Input" value={tool.input} /> : null}
          {tool.output !== undefined ? <ToolValue label="Output" value={tool.output} /> : null}
          {tool.error !== undefined ? (
            <ToolValue label="Error" value={tool.error} destructive />
          ) : null}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolValue({
  label,
  value,
  destructive = false,
}: {
  label: string;
  value: unknown;
  destructive?: boolean;
}) {
  return (
    <div>
      <dt
        className={
          destructive
            ? "text-destructive text-xs font-medium"
            : "text-muted-foreground text-xs font-medium"
        }
      >
        {label}
      </dt>
      <dd className="mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words">
        {formatValue(value)}
      </dd>
    </div>
  );
}

function toolSnapshot(record: object | null, type: string): ToolSnapshot | null {
  if (!record || (type !== "dynamic-tool" && !type.startsWith("tool-"))) {
    return null;
  }
  const rawToolName = field(record, "toolName");
  const dynamicName = typeof rawToolName === "string" ? rawToolName : null;
  const staticName = type.startsWith("tool-") ? type.slice("tool-".length) : null;
  const rawState = field(record, "state");
  const state = typeof rawState === "string" ? rawState : "unknown";
  return {
    name: dynamicName ?? staticName ?? "unknown tool",
    state,
    input: ownValue(record, "input") ?? ownValue(record, "args"),
    output: ownValue(record, "output") ?? ownValue(record, "result"),
    error: ownValue(record, "errorText") ?? ownValue(record, "error"),
  };
}

function partKey(part: unknown, index: number) {
  const record = asRecord(part);
  const stableId = record ? (field(record, "toolCallId") ?? field(record, "id")) : undefined;
  const type = record ? field(record, "type") : "part";
  return typeof stableId === "string" ? stableId : `${String(type)}-${index}`;
}

function asRecord(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function field(record: object, key: string): unknown {
  return Reflect.get(record, key);
}

function ownValue(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key) ? field(record, key) : undefined;
}

function formatValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
