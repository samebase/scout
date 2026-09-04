import { optimisticallySendMessage, useUIMessages } from "@convex-dev/agent/react";
import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SendIcon,
  TelescopeIcon,
  XIcon,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import {
  BROWSER_CLOSE_DESCRIPTION,
  BROWSER_EXECUTE_DESCRIPTION,
  BROWSER_EXECUTE_EXAMPLE,
  CREATE_FIRECRAWL_SESSION_DESCRIPTION,
} from "../../convex/scout/browserToolContract";
import {
  agentMailReplyInputSchema,
  agentMailSendInputSchema,
} from "../../convex/scout/agentMailToolInput";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ScoutRunMessageView, scoutModelLabel } from "#components/scout-run-message";
import { SdkModelInputInspector } from "#components/scout-model-input";
import { AuthPanel } from "#components/auth-panel";
import { BrowserReplay } from "#components/browser-replay";
import { Button } from "#components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "#components/ui/message-scroller";
import { Textarea } from "#components/ui/textarea";

const chatSearchSchema = z.object({
  thread: z.string().optional().catch(undefined),
  session: z.string().optional().catch(undefined),
  call: z.string().optional().catch(undefined),
});
const jsonValueSchema = z.json();
const MANUAL_SUBMISSION_STORAGE_KEY = "scout_pending_manual_email_submissions_v2";
const MANUAL_EMAIL_RETRY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const manualSubmissionSchema = z.object({
  threadId: z.string().min(1),
  toolName: z.string().min(1),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
});
const manualSubmissionsSchema = z.array(manualSubmissionSchema);

export const Route = createFileRoute("/chats")({
  validateSearch: (search) => chatSearchSchema.parse(search),
  head: () => ({
    meta: [{ title: "Chats | Scout" }],
  }),
  component: ChatsPage,
});

type ComposerState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

type ChatThread = FunctionReturnType<typeof api.scout.chats.listThreads>["page"][number];
type BrowserSession = FunctionReturnType<typeof api.scout.browserSessions.list>[number];
type BrowserSessionDetail = NonNullable<FunctionReturnType<typeof api.scout.browserSessions.get>>;
type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type InspectorKind = "browser" | "model-call";
type PendingThread = {
  threadId: string;
  scoutId: Scout["_id"];
};

const DRIVER_OPTIONS = [
  { value: "openai/gpt-5.6-luna", label: "Luna" },
  { value: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash" },
  { value: "manual", label: "Manual" },
] as const;

type ChatDriver = (typeof DRIVER_OPTIONS)[number]["value"];
type ManualToolName = FunctionArgs<typeof api.scout.manual.executeTool>["toolName"];
type ManualSubmission = z.output<typeof manualSubmissionSchema>;

const MANUAL_TOOL_OPTIONS = [
  {
    value: "create_new_firecrawl_session",
    label: "Create Firecrawl session",
    description: CREATE_FIRECRAWL_SESSION_DESCRIPTION,
    input: '{\n  "url": "https://samebase.com"\n}',
  },
  {
    value: "browser_execute",
    label: "Execute Playwright",
    description: BROWSER_EXECUTE_DESCRIPTION,
    input: JSON.stringify({ code: BROWSER_EXECUTE_EXAMPLE }, null, 2),
  },
  {
    value: "browser_close",
    label: "Close browser",
    description: BROWSER_CLOSE_DESCRIPTION,
    input: "{}",
  },
  {
    value: "web_search",
    label: "Search the web",
    description: "Search public web pages with Firecrawl.",
    input: '{\n  "query": "form builder pricing"\n}',
  },
  {
    value: "web_read",
    label: "Read a web page",
    description: "Read the content of one public web page with Firecrawl.",
    input: '{\n  "url": "https://samebase.com"\n}',
  },
  {
    value: "web_map",
    label: "Map a website",
    description: "Discover public URLs on a website with Firecrawl.",
    input: '{\n  "url": "https://samebase.com"\n}',
  },
  {
    value: "web_crawl",
    label: "Crawl a website",
    description: "Read a bounded set of public pages on a website with Firecrawl.",
    input: '{\n  "url": "https://samebase.com",\n  "limit": 5\n}',
  },
  {
    value: "list_messages",
    label: "List email",
    description: "List messages in this Scout's inbox.",
    input: '{\n  "limit": 10\n}',
  },
  {
    value: "search_messages",
    label: "Search email",
    description: "Search this Scout's inbox.",
    input: '{\n  "q": "verification"\n}',
  },
  {
    value: "get_thread",
    label: "Read email thread",
    description: "Read one email thread by its AgentMail thread ID.",
    input: '{\n  "threadId": ""\n}',
  },
  {
    value: "send_message",
    label: "Send email",
    description: "Send one email from this Scout's AgentMail inbox.",
    input: '{\n  "to": "person@example.com",\n  "subject": "",\n  "text": ""\n}',
  },
  {
    value: "reply_to_message",
    label: "Reply to email",
    description: "Reply from this Scout's inbox using an AgentMail message ID.",
    input: '{\n  "messageId": "",\n  "text": ""\n}',
  },
  {
    value: "fill_account_password",
    label: "Fill account password",
    description: "Fill the Scout's managed password into a visible password field.",
    input:
      '{\n  "passwordTarget": {\n    "kind": "role",\n    "role": "textbox",\n    "name": "Password",\n    "exact": true\n  }\n}',
  },
  {
    value: "record_authenticated_service_account",
    label: "Record authenticated account",
    description:
      "Record a login after the current browser page shows this Scout's exact account identity and a sign-out control.",
    input:
      '{\n  "accountAccess": "recovered",\n  "loginMethod": "managed_password",\n  "identityText": "",\n  "sessionControlText": "Sign out"\n}',
  },
  {
    value: "inspect_tool_arguments",
    label: "Inspect argument types",
    description: "Check the raw JSON types received by the tool boundary.",
    input:
      '{\n  "stringValue": "plain text",\n  "numberValue": 42,\n  "booleanValue": true,\n  "objectValue": { "label": "nested", "count": 2 },\n  "arrayValue": ["alpha", "beta"],\n  "nullValue": null\n}',
  },
] as const satisfies readonly {
  value: ManualToolName;
  label: string;
  description: string;
  input: string;
}[];

const DEFAULT_DRIVER: ChatDriver = "qwen/qwen3.7-flash";
const DEFAULT_CONTEXT_PANEL_HEIGHT = 288;
const MIN_CONTEXT_PANEL_HEIGHT = 144;
const CONTEXT_PANEL_RESIZE_STEP = 48;
const THREAD_PAGE_SIZE = 50;
const CHAT_RESIZE_HANDLE_LABELS = {
  left: "Resize chat navigation",
  right: "Resize conversation",
} satisfies SidebarLayoutResizeHandleLabels;
const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;
const threadDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "short",
});

function ChatsPage() {
  return (
    <>
      <AuthLoading>
        <main className="grid min-h-[100dvh] place-items-center p-6">
          <p className="text-muted-foreground text-sm">Loading account...</p>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <main className="grid min-h-[100dvh] place-items-center p-5 sm:p-10">
          <div className="w-full max-w-md">
            <h1 className="mb-7 flex items-center gap-3 text-xl font-semibold tracking-[-0.03em]">
              <TelescopeIcon className="size-6 text-primary" aria-hidden="true" />
              Scout
            </h1>
            <AuthPanel />
          </div>
        </main>
      </Unauthenticated>
      <Authenticated>
        <main className="flex h-[calc(100dvh-4rem)] min-h-0 w-full flex-col">
          <ChatsWorkspace />
        </main>
      </Authenticated>
    </>
  );
}

function validJson(value: string) {
  try {
    return jsonValueSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

function canonicalJson(value: z.output<typeof jsonValueSchema>): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedManualInput(toolName: ManualToolName, value: string) {
  const parsed = jsonValueSchema.parse(JSON.parse(value));
  if (toolName === "send_message") {
    const normalized = agentMailSendInputSchema.safeParse(parsed);
    return normalized.success ? normalized.data : parsed;
  }
  if (toolName === "reply_to_message") {
    const normalized = agentMailReplyInputSchema.safeParse(parsed);
    return normalized.success ? normalized.data : parsed;
  }
  return parsed;
}

async function manualInputFingerprint(toolName: ManualToolName, value: string) {
  const parsed = normalizedManualInput(toolName, value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(parsed)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPendingManualSubmissions(): ManualSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    const serialized = window.localStorage.getItem(MANUAL_SUBMISSION_STORAGE_KEY);
    if (!serialized) return [];
    const parsed = manualSubmissionsSchema.safeParse(JSON.parse(serialized));
    if (parsed.success) return parsed.data;
    window.localStorage.removeItem(MANUAL_SUBMISSION_STORAGE_KEY);
  } catch {
    // Invalid or unavailable browser storage should not prevent manual tools from running.
  }
  return [];
}

function writePendingManualSubmissions(submissions: ManualSubmission[]) {
  try {
    if (submissions.length > 0) {
      window.localStorage.setItem(MANUAL_SUBMISSION_STORAGE_KEY, JSON.stringify(submissions));
    } else {
      window.localStorage.removeItem(MANUAL_SUBMISSION_STORAGE_KEY);
    }
  } catch {
    // The in-memory operation still protects retries until this component is replaced.
  }
}

function isManualEmailWrite(toolName: ManualToolName) {
  return toolName === "send_message" || toolName === "reply_to_message";
}

function threadLabel(thread: ChatThread) {
  return thread.title?.trim() || "New chat";
}

function chatDriverLabel(driver: ChatDriver) {
  return driver === "manual" ? "Manual" : scoutModelLabel(driver);
}

function selectBrowserSession(
  sessions: readonly BrowserSession[] | undefined,
  requestedSessionId: string | undefined,
) {
  return sessions?.find((session) => session.sessionId === requestedSessionId) ?? sessions?.at(-1);
}

function ChatsWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { setMobilePane } = useSidebarActions();
  const threads = usePaginatedQuery(
    api.scout.chats.listThreads,
    {},
    { initialNumItems: THREAD_PAGE_SIZE },
  );
  const scouts = useQuery(api.scout.scouts.list);
  const sendMessage = useMutation(api.scout.chats.sendMessage).withOptimisticUpdate(
    optimisticallySendMessage(api.scout.chats.listMessages),
  );
  const executeManualTool = useAction(api.scout.manual.executeTool);
  const [selectedDriver, setSelectedDriver] = useState<ChatDriver>(DEFAULT_DRIVER);
  const [manualTool, setManualTool] = useState<(typeof MANUAL_TOOL_OPTIONS)[number]>(
    MANUAL_TOOL_OPTIONS[0],
  );
  const [manualInput, setManualInput] = useState<string>(MANUAL_TOOL_OPTIONS[0].input);
  const [draft, setDraft] = useState("");
  const [contextPanelHeight, setContextPanelHeight] = useState(DEFAULT_CONTEXT_PANEL_HEIGHT);
  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });
  const [pendingThread, setPendingThread] = useState<PendingThread | null>(null);
  const [createChatOpen, setCreateChatOpen] = useState(false);
  const [createChatSubmitting, setCreateChatSubmitting] = useState(false);
  const createChatButton = useRef<HTMLButtonElement>(null);
  const pendingManualSubmissions = useRef<ManualSubmission[]>(readPendingManualSubmissions());
  const manualSubmissionInFlight = useRef(false);
  const contextResize = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const availableScouts = scouts ?? [];
  const activeScouts = availableScouts.filter((scout) => scout.status === "active");
  const availableThreads = threads.results;
  const requestedThread = availableThreads.find((thread) => thread.threadId === search.thread);
  const requestedPendingThread = pendingThread?.threadId === search.thread ? pendingThread : null;
  const threadId =
    requestedThread?.threadId ??
    requestedPendingThread?.threadId ??
    (search.thread === undefined ? availableThreads[0]?.threadId : undefined) ??
    null;
  const selectedThread = availableThreads.find((thread) => thread.threadId === threadId);
  const selectedScoutId = selectedThread?.scoutId ?? requestedPendingThread?.scoutId;
  const selectedScout = availableScouts.find((scout) => scout._id === selectedScoutId);
  const selectedActiveScout = selectedScout?.status === "active" ? selectedScout : undefined;
  const scoutActivity = useQuery(
    api.scout.chats.getScoutActivity,
    selectedScoutId ? { scoutId: selectedScoutId } : "skip",
  );
  const agentContext = useQuery(
    api.scout.chats.getThreadAgentContext,
    threadId ? { threadId } : "skip",
  );
  const messages = useUIMessages(api.scout.chats.listMessages, threadId ? { threadId } : "skip", {
    initialNumItems: THREAD_PAGE_SIZE,
    stream: true,
  });
  const browserSessions = useQuery(
    api.scout.browserSessions.list,
    threadId ? { threadId } : "skip",
  );
  const selectedBrowserSession = selectBrowserSession(browserSessions, search.session);
  const browserSession = useQuery(
    api.scout.browserSessions.get,
    selectedBrowserSession ? { sessionId: selectedBrowserSession.sessionId } : "skip",
  );
  const liveView = useQuery(
    api.scout.browserSessions.liveView,
    selectedBrowserSession ? { sessionId: selectedBrowserSession.sessionId } : "skip",
  );
  const activeHandoff = useQuery(
    api.humanHandoffs.active,
    selectedBrowserSession ? { sessionId: selectedBrowserSession.sessionId } : "skip",
  );
  const isActivityLoading = selectedScoutId !== undefined && scoutActivity === undefined;
  const isWorking =
    composerState.kind === "sending" || isActivityLoading || scoutActivity?.active === true;
  const isLoading = threads.status === "LoadingFirstPage" || scouts === undefined;
  const canCompose = Boolean(selectedActiveScout && threadId !== null);
  const isLocatingRequestedThread =
    search.thread !== undefined &&
    requestedThread === undefined &&
    requestedPendingThread === null &&
    threads.status !== "Exhausted";
  const selectionMissing =
    search.thread !== undefined &&
    requestedThread === undefined &&
    requestedPendingThread === null &&
    threads.status === "Exhausted";
  const currentThreadId = useRef(threadId);
  const knownBrowserSessions = useRef<{
    threadId: string;
    sessionIds: ReadonlySet<BrowserSession["sessionId"]>;
  } | null>(null);
  currentThreadId.current = threadId;

  useEffect(() => {
    if (!threadId || browserSessions === undefined) return;
    const previousSessions = knownBrowserSessions.current;
    const newlyCreatedSession =
      previousSessions?.threadId === threadId
        ? browserSessions.findLast((session) => !previousSessions.sessionIds.has(session.sessionId))
        : undefined;
    knownBrowserSessions.current = {
      threadId,
      sessionIds: new Set(browserSessions.map((session) => session.sessionId)),
    };
    const sessionId = newlyCreatedSession?.sessionId ?? selectedBrowserSession?.sessionId;
    if (search.thread === threadId && search.session === sessionId) return;
    void navigate({
      to: "/chats",
      replace: true,
      search: {
        thread: threadId,
        ...(sessionId ? { session: sessionId } : {}),
        ...(search.call ? { call: search.call } : {}),
      },
    });
  }, [
    browserSessions,
    navigate,
    search.call,
    search.session,
    search.thread,
    selectedBrowserSession,
    threadId,
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
  }, [search.thread]);

  const resetForNavigation = () => {
    setDraft("");
    setComposerState((current) => (current.kind === "failed" ? { kind: "idle" } : current));
    setPendingThread(null);
    setCreateChatOpen(false);
  };

  const closeCreateChat = () => {
    if (createChatSubmitting) return;
    setCreateChatOpen(false);
    setMobilePane("main");
    requestAnimationFrame(() => createChatButton.current?.focus());
  };

  const onChatCreated = (created: PendingThread) => {
    setCreateChatSubmitting(false);
    setPendingThread(created);
    setDraft("");
    setComposerState({ kind: "idle" });
    setCreateChatOpen(false);
    void navigate({ to: "/chats", search: { thread: created.threadId } });
    setMobilePane("main");
  };

  const submitPrompt = async () => {
    const prompt = draft.trim();
    if (selectedDriver === "manual" || !prompt || isWorking || !selectedActiveScout || !threadId) {
      return;
    }

    setComposerState({ kind: "sending" });
    setDraft("");
    try {
      await sendMessage({ threadId, prompt, model: selectedDriver });
      setComposerState({ kind: "idle" });
    } catch {
      if (currentThreadId.current === threadId) {
        setDraft(prompt);
        setComposerState({ kind: "failed", message: "Scout could not accept that message." });
      } else {
        setComposerState({ kind: "idle" });
      }
    }
  };

  const submitManualTool = async () => {
    if (
      selectedDriver !== "manual" ||
      isWorking ||
      manualSubmissionInFlight.current ||
      !selectedActiveScout ||
      !threadId
    )
      return;
    if (!validJson(manualInput)) {
      setComposerState({ kind: "failed", message: "Tool input must be valid JSON." });
      return;
    }

    manualSubmissionInFlight.current = true;
    try {
      const inputFingerprint = await manualInputFingerprint(manualTool.value, manualInput);
      const emailWrite = isManualEmailWrite(manualTool.value);
      const pending = emailWrite
        ? pendingManualSubmissions.current.find(
            (submission) =>
              submission.threadId === threadId &&
              submission.toolName === manualTool.value &&
              submission.inputFingerprint === inputFingerprint,
          )
        : undefined;
      if (pending && Date.now() - pending.createdAt >= MANUAL_EMAIL_RETRY_WINDOW_MS) {
        pendingManualSubmissions.current = pendingManualSubmissions.current.filter(
          (candidate) => candidate.operationId !== pending.operationId,
        );
        writePendingManualSubmissions(pendingManualSubmissions.current);
        setComposerState({
          kind: "failed",
          message:
            "This email has an unresolved delivery result older than 24 hours. Check the Scout inbox before trying again.",
        });
        return;
      }
      const submission = pending ?? {
        threadId,
        toolName: manualTool.value,
        inputFingerprint,
        operationId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      if (emailWrite && !pending) {
        pendingManualSubmissions.current = [...pendingManualSubmissions.current, submission];
        writePendingManualSubmissions(pendingManualSubmissions.current);
      }
      setComposerState({ kind: "sending" });
      const result = await executeManualTool({
        threadId,
        toolName: manualTool.value,
        input: manualInput,
        operationId: submission.operationId,
      });
      if (emailWrite && result.outcome.kind === "success") {
        pendingManualSubmissions.current = pendingManualSubmissions.current.filter(
          (candidate) => candidate.operationId !== submission.operationId,
        );
        writePendingManualSubmissions(pendingManualSubmissions.current);
      }
      setComposerState({ kind: "idle" });
    } catch {
      setComposerState(
        currentThreadId.current === threadId
          ? { kind: "failed", message: "The manual tool call could not be submitted." }
          : { kind: "idle" },
      );
    } finally {
      manualSubmissionInFlight.current = false;
    }
  };

  const submitComposer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void (selectedDriver === "manual" ? submitManualTool() : submitPrompt());
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  const boundedContextPanelHeight = (height: number) =>
    Math.max(
      MIN_CONTEXT_PANEL_HEIGHT,
      Math.min(height, window.innerHeight - MIN_CONTEXT_PANEL_HEIGHT),
    );

  const onContextResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    contextResize.current = {
      pointerId: event.pointerId,
      startHeight: contextPanelHeight,
      startY: event.clientY,
    };
  };

  const onContextResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = contextResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setContextPanelHeight(
      boundedContextPanelHeight(resize.startHeight + resize.startY - event.clientY),
    );
  };

  const onContextResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (contextResize.current?.pointerId !== event.pointerId) return;
    contextResize.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onContextResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setContextPanelHeight((height) =>
      boundedContextPanelHeight(
        height + (event.key === "ArrowUp" ? CONTEXT_PANEL_RESIZE_STEP : -CONTEXT_PANEL_RESIZE_STEP),
      ),
    );
  };

  const onDriverChange = (value: string) => {
    const option = DRIVER_OPTIONS.find((candidate) => candidate.value === value);
    if (option) {
      setSelectedDriver(option.value);
      setComposerState({ kind: "idle" });
    }
  };

  const onManualToolChange = (value: string) => {
    const option = MANUAL_TOOL_OPTIONS.find((candidate) => candidate.value === value);
    if (option) {
      setManualTool(option);
      setManualInput(option.input);
      setComposerState({ kind: "idle" });
    }
  };

  const emptyTranscript = emptyTranscriptCopy({
    isLoading:
      isLoading ||
      isLocatingRequestedThread ||
      (threadId !== null && messages.status === "LoadingFirstPage"),
    hasThread: threadId !== null,
    selectionMissing,
  });

  const openModelCall = (modelCallId: string) => {
    void navigate({
      to: "/chats",
      replace: true,
      search: { ...search, call: modelCallId },
    });
  };

  const closeModelCall = () => {
    void navigate({
      to: "/chats",
      replace: true,
      search: {
        ...(search.thread ? { thread: search.thread } : {}),
        ...(search.session ? { session: search.session } : {}),
      },
    });
    if (!selectedBrowserSession) setMobilePane("main");
  };

  const hasBrowser = selectedBrowserSession !== undefined && !createChatOpen;
  const inspectorKind: InspectorKind | null = createChatOpen
    ? null
    : search.call
      ? "model-call"
      : hasBrowser
        ? "browser"
        : null;
  const conversation = (
    <PaneFrame
      header={<div className="flex h-full items-center px-4 text-xs font-semibold">Chat</div>}
      content={
        <section aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
          {activeHandoff?.phase === "delivery_failed" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-3"
            >
              <p className="text-sm">
                Scout could not deliver the private handoff link. Check its inbox, then ask Scout to
                try the human-help request again.
              </p>
            </div>
          ) : activeHandoff ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
              <p className="text-sm">{activeHandoff.reason}</p>
              <Button asChild size="sm" variant="outline">
                <Link to="/handoff/$handoffId" params={{ handoffId: activeHandoff.handoffId }}>
                  Open browser handoff
                </Link>
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <MessageScrollerProvider autoScroll scrollPreviousItemPeek={48}>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent className="px-3 py-5 @sm:px-5" aria-busy={isWorking}>
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
                        <ScoutRunMessageView message={message} onSelectModelCall={openModelCall} />
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>

          <form
            className="chat-composer shrink-0 overflow-y-auto border-t bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] p-3 @sm:p-4"
            onSubmit={submitComposer}
          >
            {selectedScout && !selectedActiveScout ? (
              <p className="text-muted-foreground mb-2 text-sm">
                Activate {selectedScout.displayName} to continue this chat.
              </p>
            ) : activeScouts.length === 0 && scouts !== undefined ? (
              <p className="text-muted-foreground mb-2 text-sm">
                Register an active scout before starting a chat.{" "}
                <Link to="/scouts" className="text-foreground underline underline-offset-4">
                  Register a scout
                </Link>
              </p>
            ) : null}
            {threadId ? (
              <details className="mb-2 rounded-lg border border-input bg-card text-xs">
                <summary className="cursor-pointer px-3 py-2 font-medium">Agent context</summary>
                <div
                  role="separator"
                  aria-label="Resize agent context"
                  aria-orientation="horizontal"
                  aria-valuemin={MIN_CONTEXT_PANEL_HEIGHT}
                  aria-valuenow={Math.round(contextPanelHeight)}
                  tabIndex={0}
                  className="group flex h-2 touch-none cursor-row-resize items-center border-t px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onKeyDown={onContextResizeKeyDown}
                  onPointerDown={onContextResizeStart}
                  onPointerMove={onContextResizeMove}
                  onPointerUp={onContextResizeEnd}
                  onPointerCancel={onContextResizeEnd}
                >
                  <span className="bg-border group-hover:bg-foreground/30 mx-auto h-px w-12 transition-colors" />
                </div>
                <div
                  className="space-y-3 overflow-auto px-3 pb-3"
                  style={{ height: contextPanelHeight }}
                >
                  <section>
                    <h3 className="mb-1 font-medium">Instructions</h3>
                    <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[0.6875rem] leading-relaxed">
                      {agentContext?.instructions ?? "Loading…"}
                    </pre>
                  </section>
                  <section>
                    <h3 className="mb-1 font-medium">browser_execute</h3>
                    <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[0.6875rem] leading-relaxed">
                      {BROWSER_EXECUTE_DESCRIPTION}
                    </pre>
                  </section>
                </div>
              </details>
            ) : null}
            <div className="rounded-[0.875rem] border border-input bg-card p-2 shadow-[0_4px_18px_color-mix(in_oklch,var(--foreground)_5%,transparent)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
              {selectedDriver === "manual" ? (
                <details className="px-2 pt-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Tool instructions
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap py-2 font-mono text-[0.6875rem]">
                    {manualTool.description}
                  </pre>
                </details>
              ) : null}
              <Textarea
                value={selectedDriver === "manual" ? manualInput : draft}
                onChange={(event) =>
                  selectedDriver === "manual"
                    ? setManualInput(event.target.value)
                    : setDraft(event.target.value)
                }
                onKeyDown={selectedDriver === "manual" ? undefined : onComposerKeyDown}
                placeholder={
                  selectedDriver === "manual"
                    ? "JSON tool input"
                    : canCompose && selectedActiveScout
                      ? `Ask ${selectedActiveScout.displayName} to inspect, research, or explain...`
                      : "Create or select a chat."
                }
                aria-label={selectedDriver === "manual" ? "Tool input" : "Message Scout"}
                rows={selectedDriver === "manual" ? 5 : 2}
                disabled={isWorking || !canCompose}
                className={`max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent ${
                  selectedDriver === "manual" ? "font-mono text-xs" : ""
                }`}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="text-muted-foreground text-xs" htmlFor="chat-driver">
                    Driver
                  </label>
                  <select
                    id="chat-driver"
                    value={selectedDriver}
                    disabled={isWorking}
                    onChange={(event) => onDriverChange(event.currentTarget.value)}
                    className="border-input bg-background h-8 min-w-0 rounded-md border px-2 text-xs"
                  >
                    {DRIVER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {selectedDriver === "manual" ? (
                    <>
                      <label className="text-muted-foreground text-xs" htmlFor="chat-manual-tool">
                        Tool
                      </label>
                      <select
                        id="chat-manual-tool"
                        value={manualTool.value}
                        disabled={isWorking}
                        onChange={(event) => onManualToolChange(event.currentTarget.value)}
                        className="border-input bg-background h-8 min-w-0 rounded-md border px-2 text-xs"
                      >
                        {MANUAL_TOOL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-muted-foreground hidden text-xs @lg:block">
                    {selectedDriver === "manual"
                      ? "Run one tool call."
                      : "Enter to send. Shift+Enter for a new line."}
                  </p>
                  <Button
                    type="submit"
                    size="icon-sm"
                    disabled={
                      isWorking ||
                      !canCompose ||
                      (selectedDriver === "manual" ? !manualInput.trim() : !draft.trim())
                    }
                    aria-label={selectedDriver === "manual" ? "Run tool" : "Send message"}
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
      }
      scrollRestorationId={`chat-thread:${threadId ?? "empty"}`}
    />
  );
  const inspector =
    search.call && threadId ? (
      <PaneFrame
        header={
          <div className="flex h-full items-center gap-2 px-2 text-xs font-semibold">
            <Button type="button" variant="ghost" size="sm" onClick={closeModelCall}>
              <ArrowLeftIcon />
              Back
            </Button>
            <span>SDK model input</span>
          </div>
        }
        content={<SdkModelInputInspector modelCallId={search.call} threadId={threadId} />}
        scrollRestorationId={`model-call:${search.call}`}
      />
    ) : hasBrowser ? (
      <PaneFrame
        header={
          browserSessions && browserSessions.length > 1 ? (
            <BrowserSessionPicker
              sessions={browserSessions}
              selectedSessionId={selectedBrowserSession.sessionId}
              onSelectSession={(sessionId) =>
                void navigate({
                  to: "/chats",
                  search: { ...search, session: sessionId },
                })
              }
            />
          ) : undefined
        }
        content={
          <ChatBrowserView
            liveViewUrl={liveView?.url ?? null}
            session={browserSession ?? undefined}
          />
        }
      />
    ) : undefined;

  return (
    <>
      <SidebarLayout
        addressChrome={
          <ChatChrome
            createButtonRef={createChatButton}
            createOpen={createChatOpen}
            createSubmitting={createChatSubmitting}
            loadingScouts={scouts === undefined}
            inspectorKind={inspectorKind}
            inspectionKey={search.call ?? selectedBrowserSession?.sessionId ?? null}
            driver={selectedDriver}
            thread={selectedThread}
            scout={selectedScout}
            onToggleCreate={() => {
              if (createChatOpen) {
                closeCreateChat();
              } else {
                setCreateChatOpen(true);
                setMobilePane("main");
              }
            }}
          />
        }
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <ChatNavigation
                threads={threads.status === "LoadingFirstPage" ? undefined : availableThreads}
                scouts={availableScouts}
                canLoadMore={threads.status === "CanLoadMore"}
                isLoadingMore={threads.status === "LoadingMore"}
                selectedThreadId={threadId}
                onLoadMore={() => threads.loadMore(THREAD_PAGE_SIZE)}
                onNavigate={() => {
                  resetForNavigation();
                  setMobilePane("main");
                }}
              />
            }
            scrollRestorationId="chat-navigation"
          />
        }
        main={
          createChatOpen ? (
            <PaneFrame
              content={
                <NewChatForm
                  scouts={activeScouts}
                  initialScoutId={selectedActiveScout?._id}
                  onCancel={closeCreateChat}
                  onCreated={onChatCreated}
                  onSubmittingChange={setCreateChatSubmitting}
                />
              }
            />
          ) : (
            conversation
          )
        }
        {...(inspector ? { right: inspector } : {})}
        resizeHandleLabels={CHAT_RESIZE_HANDLE_LABELS}
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

function BrowserSessionPicker({
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  sessions: readonly BrowserSession[];
  selectedSessionId: BrowserSession["sessionId"];
  onSelectSession: (sessionId: BrowserSession["sessionId"]) => void;
}) {
  return (
    <select
      aria-label="Browser session"
      value={selectedSessionId}
      onChange={(event) => {
        const selected = sessions.find(
          (session) => session.sessionId === event.currentTarget.value,
        );
        if (selected) onSelectSession(selected.sessionId);
      }}
      className="h-full w-full bg-background px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {sessions.map((session) => (
        <option key={session.sessionId} value={session.sessionId}>
          Session {session.sequence}
          {session.lifecycle.kind === "active"
            ? " · Live"
            : session.lifecycle.kind === "closing"
              ? " · Closing"
              : ""}
        </option>
      ))}
    </select>
  );
}

function ChatBrowserView({
  liveViewUrl,
  session,
}: {
  liveViewUrl: string | null;
  session: BrowserSessionDetail | undefined;
}) {
  if (!session) return <ChatViewStatus>Loading browser session</ChatViewStatus>;
  if (session.lifecycle.kind === "closed") {
    return <BrowserReplay key={session.sessionId} sessionId={session.sessionId} />;
  }
  if (session.lifecycle.kind === "closing") {
    return <ChatViewStatus>Closing browser session</ChatViewStatus>;
  }
  if (!liveViewUrl) return <ChatViewStatus>Connecting to live browser</ChatViewStatus>;
  return (
    <section className="chat-browser" aria-label="Live browser">
      <div className="chat-browser-bar">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LoaderCircleIcon className="size-3.5 animate-spin text-primary" aria-hidden="true" />
          <span className="truncate text-xs font-medium">Live · Session {session.sequence}</span>
        </span>
        <Button asChild size="xs" variant="ghost">
          <a href={liveViewUrl} target="_blank" rel="noreferrer">
            Open
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <div className="chat-browser-narrow">
        <a href={liveViewUrl} target="_blank" rel="noreferrer">
          Open live browser
        </a>
      </div>
      <iframe
        src={liveViewUrl}
        title={`Live browser session ${session.sequence}`}
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts"
        className="chat-browser-frame"
      />
    </section>
  );
}

function ChatViewStatus({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-12 text-center">
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function ChatChrome({
  createButtonRef,
  createOpen,
  createSubmitting,
  loadingScouts,
  inspectorKind,
  inspectionKey,
  driver,
  thread,
  scout,
  onToggleCreate,
}: {
  createButtonRef: RefObject<HTMLButtonElement | null>;
  createOpen: boolean;
  createSubmitting: boolean;
  loadingScouts: boolean;
  inspectorKind: InspectorKind | null;
  inspectionKey: string | null;
  driver: ChatDriver;
  thread: ChatThread | undefined;
  scout: Scout | undefined;
  onToggleCreate: () => void;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, rightDesktopOpen, mobilePane } =
    useSidebarLayoutPresentation();
  const navigationShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const inspectorShown = isMobile ? mobilePane === "right" : rightDesktopOpen;
  const inspectorLabel = inspectorKind === "model-call" ? "model call" : "browser";
  const previousInspectionKey = useRef<string | null>(null);

  useEffect(() => {
    const changed = inspectionKey !== null && inspectionKey !== previousInspectionKey.current;
    previousInspectionKey.current = inspectionKey;
    if (!changed) return;

    if (isMobile) {
      setMobilePane("right");
    } else if (!rightDesktopOpen) {
      toggleRightPane();
    }
  }, [inspectionKey, isMobile, rightDesktopOpen, setMobilePane, toggleRightPane]);

  return (
    <div className="flex h-12 min-w-0 items-center gap-2 px-2 sm:px-4">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={navigationShown ? "Hide chats" : "Show chats"}
        aria-pressed={navigationShown}
        onClick={() =>
          isMobile ? setMobilePane(navigationShown ? "main" : "left") : toggleLeftPane()
        }
      >
        <PanelLeftIcon />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{thread ? threadLabel(thread) : "Chats"}</h1>
        <p className="text-muted-foreground hidden truncate text-xs sm:block">
          {scout ? (
            <>
              <Link
                to="/scouts/$slug"
                params={{ slug: scout.slug }}
                className="underline-offset-4 hover:underline"
              >
                {scout.displayName}
              </Link>
              {" · "}
            </>
          ) : null}
          {chatDriverLabel(driver)}
        </p>
      </div>
      {inspectorKind ? (
        isMobile ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={inspectorShown ? "Show chat" : `Show ${inspectorLabel}`}
            aria-pressed={inspectorShown}
            onClick={() => setMobilePane(inspectorShown ? "main" : "right")}
          >
            {inspectorShown ? <ArrowLeftIcon /> : <MonitorIcon />}
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={inspectorShown ? `Hide ${inspectorLabel}` : `Show ${inspectorLabel}`}
            aria-pressed={inspectorShown}
            onClick={toggleRightPane}
          >
            <PanelRightIcon />
          </Button>
        )
      ) : null}
      <Button
        ref={createButtonRef}
        type="button"
        size="sm"
        aria-expanded={createOpen}
        aria-controls="create-chat-panel"
        disabled={createSubmitting || loadingScouts}
        onClick={onToggleCreate}
      >
        {createOpen ? <XIcon /> : <PlusIcon />}
        {createOpen ? "Close" : "New chat"}
      </Button>
    </div>
  );
}

function ChatNavigation({
  threads,
  scouts,
  canLoadMore,
  isLoadingMore,
  selectedThreadId,
  onLoadMore,
  onNavigate,
}: {
  threads: readonly ChatThread[] | undefined;
  scouts: readonly Scout[];
  canLoadMore: boolean;
  isLoadingMore: boolean;
  selectedThreadId: string | null;
  onLoadMore: () => void;
  onNavigate: () => void;
}) {
  if (threads === undefined) {
    return (
      <nav
        className="min-h-full bg-sidebar p-4 text-sm text-muted-foreground"
        aria-label="Chats"
        aria-busy="true"
      >
        Loading chats...
      </nav>
    );
  }

  return (
    <nav className="min-h-full bg-sidebar" aria-label="Chats">
      {threads.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">No chats yet</p>
      ) : (
        <ul className="divide-y">
          {threads.map((thread) => {
            const selected = thread.threadId === selectedThreadId;
            const scout = scouts.find((candidate) => candidate._id === thread.scoutId);
            return (
              <li key={thread.threadId}>
                <Link
                  to="/chats"
                  search={{ thread: thread.threadId }}
                  aria-current={selected ? "page" : undefined}
                  onClick={onNavigate}
                  className={`block border-l-2 px-4 py-3 outline-none transition-colors hover:bg-sidebar-accent/55 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-sidebar-ring/40 ${
                    selected
                      ? "border-primary bg-sidebar-accent text-foreground"
                      : "border-transparent text-muted-foreground"
                  }`}
                >
                  <span className="block wrap-break-word text-sm leading-snug">
                    {threadLabel(thread)}
                  </span>
                  {scout ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {scout.displayName}
                    </span>
                  ) : null}
                  <time
                    className="mt-0.5 block font-mono text-[0.625rem]"
                    dateTime={new Date(thread.creationTime).toISOString()}
                  >
                    {threadDate.format(thread.creationTime)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
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
            {isLoadingMore ? "Loading history" : "Load older chats"}
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

type ChatFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

function NewChatForm({
  scouts,
  initialScoutId,
  onCancel,
  onCreated,
  onSubmittingChange,
}: {
  scouts: readonly Scout[];
  initialScoutId: Scout["_id"] | undefined;
  onCancel: () => void;
  onCreated: (thread: PendingThread) => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const createThread = useMutation(api.scout.chats.createThread);
  const [scoutId, setScoutId] = useState<string>(initialScoutId ?? scouts[0]?._id ?? "");
  const [state, setState] = useState<ChatFormState>({ kind: "idle" });
  const submitting = state.kind === "submitting";
  const selectedScout = scouts.find((scout) => scout._id === scoutId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !selectedScout) return;
    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      const created = await createThread({ scoutId: selectedScout._id });
      onCreated({ threadId: created.threadId, scoutId: selectedScout._id });
    } catch {
      onSubmittingChange(false);
      setState({ kind: "failed", message: "Could not create the chat. Try again." });
    }
  };

  return (
    <section
      id="create-chat-panel"
      className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"
      aria-labelledby="create-chat-heading"
    >
      <div className="max-w-md">
        <h2 id="create-chat-heading" className="text-xl font-semibold tracking-[-0.025em]">
          New chat
        </h2>
        {scouts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Register an active Scout to start a chat.{" "}
            <Link to="/scouts" className="text-foreground underline underline-offset-4">
              Manage Scouts
            </Link>
          </p>
        ) : null}
        <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
          <div>
            <label className="text-sm font-medium" htmlFor="chat-scout">
              Scout
            </label>
            <select
              id="chat-scout"
              name="scoutId"
              value={scoutId}
              autoFocus
              required
              disabled={submitting || scouts.length === 0}
              onChange={(event) => {
                setScoutId(event.currentTarget.value);
                setState({ kind: "idle" });
              }}
              className="border-input bg-card mt-1.5 h-10 w-full rounded-[0.625rem] border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
            >
              <option value="">Choose a Scout</option>
              {scouts.map((scout) => (
                <option key={scout._id} value={scout._id}>
                  {scout.displayName} /{scout.slug}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !selectedScout}>
              {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
              {submitting ? "Creating" : "Create chat"}
            </Button>
          </div>
          {state.kind === "failed" ? (
            <p className="text-destructive text-sm" role="alert">
              {state.message}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}

function emptyTranscriptCopy({
  isLoading,
  hasThread,
  selectionMissing,
}: {
  isLoading: boolean;
  hasThread: boolean;
  selectionMissing: boolean;
}) {
  if (isLoading) {
    return { title: "Opening the chat", description: "The saved conversation will appear here." };
  }
  if (hasThread) {
    return { title: "Empty chat", description: "Send a message or run a manual tool to begin." };
  }
  if (selectionMissing) {
    return { title: "Chat not available", description: "Choose another chat from the history." };
  }
  return { title: "Start a chat", description: "Use New chat to choose a Scout." };
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
