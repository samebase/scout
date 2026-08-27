import { optimisticallySendMessage, type UIMessage, useUIMessages } from "@convex-dev/agent/react";
import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
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
    meta: [
      { title: "Agent lab | Scout" },
      { name: "description", content: "Run and inspect Scout agent conversations." },
    ],
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

function LabPage() {
  return (
    <main className="mx-auto flex h-[calc(100dvh-3.25rem)] w-full max-w-4xl flex-col gap-4 px-4 pb-4">
      <AuthLoading>
        <p className="text-muted-foreground py-10 text-sm">Loading agent lab...</p>
      </AuthLoading>
      <Unauthenticated>
        <section className="my-auto rounded-xl border p-6">
          <h1 className="text-lg font-medium">Admin access required</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Sign in from the home page to use the lab.
          </p>
        </section>
      </Unauthenticated>
      <Authenticated>
        <AgentLab />
      </Authenticated>
    </main>
  );
}

function AgentLab() {
  const latestThread = useQuery(api.scout.lab.latestThread);
  const createThread = useMutation(api.scout.lab.createThread);
  const sendMessage = useMutation(api.scout.lab.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.scout.lab.listMessages),
  );
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });
  const threadId = selectedThreadId ?? latestThread?.threadId ?? null;
  const messages = useUIMessages(api.scout.lab.listMessages, threadId ? { threadId } : "skip", {
    initialNumItems: 50,
    stream: true,
  });
  const isBusy = composerState.kind === "creating" || composerState.kind === "sending";
  const isStreaming = messages.results.some((message) => message.status === "streaming");

  const onNewThread = async () => {
    if (isBusy) {
      return;
    }
    setComposerState({ kind: "creating" });
    try {
      const created = await createThread({});
      setSelectedThreadId(created.threadId);
      setComposerState({ kind: "idle" });
    } catch {
      setComposerState({ kind: "failed", message: "Could not create a new thread." });
    }
  };

  const submitPrompt = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isBusy) {
      return;
    }

    setComposerState({ kind: "sending" });
    let activeThreadId = threadId;
    try {
      if (!activeThreadId) {
        const created = await createThread({});
        activeThreadId = created.threadId;
        setSelectedThreadId(created.threadId);
      }
      setDraft("");
      await sendMessage({ threadId: activeThreadId, prompt });
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
            <span className="text-muted-foreground text-xs">Luna</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
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
        <div className="border-b px-4 py-2 font-mono text-[0.6875rem] text-muted-foreground">
          {threadId ? `thread ${threadId.slice(0, 12)}` : "no thread yet"}
        </div>
        <div className="min-h-0 flex-1">
          <MessageScrollerProvider autoScroll scrollPreviousItemPeek={48}>
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="px-4 py-6 sm:px-6" aria-busy={isStreaming}>
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
                  {messages.results.length === 0 ? (
                    <EmptyTranscript isLoading={latestThread === undefined} />
                  ) : null}
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
          <div className="focus-within:border-ring focus-within:ring-ring/30 rounded-xl border bg-background p-2 transition-shadow focus-within:ring-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask Scout to inspect, research, or explain..."
              aria-label="Message Scout"
              rows={2}
              disabled={isBusy}
              className="max-h-40 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between gap-3 px-1 pt-1">
              <p className="text-muted-foreground text-xs">
                Enter to send. Shift+Enter for a new line.
              </p>
              <Button
                type="submit"
                size="icon-sm"
                disabled={isBusy || !draft.trim()}
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

function LabMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.role === "system" ? "System" : "Scout";

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
        ) : null}
        {message.status === "streaming" ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Scout is working
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function MessagePart({ part, role }: { part: unknown; role: UIMessage["role"] }) {
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
