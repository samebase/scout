// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionArgs, type FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useSyncExternalStore, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vite-plus/test";
import {
  BROWSER_EXECUTE_DESCRIPTION,
  BROWSER_EXECUTE_EXAMPLE,
} from "../../convex/scout/browserToolContract";
import { ROLE_ACCESS_GRANTS } from "../../shared/accessModel";
import { Route as ChatsRoute } from "../routes/chats";
import { Route as IndexRoute } from "../routes/index";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import { AppNavigation } from "./app-navigation";

const remote = vi.hoisted(() => ({
  authenticated: true,
  queries: new Map<string, unknown>(),
  revision: 0,
  subscribers: new Set<() => void>(),
  actions: new Map<string, Mock>(),
  mutations: new Map<string, Mock>(),
  queryCalls: vi.fn(),
  createThread: vi.fn(),
  sendMessage: vi.fn(),
  saveModelSelection: vi.fn(),
  stopScout: vi.fn(),
  executeTool: vi.fn(),
  getModelCallContext: vi.fn(),
  listReplayPages: vi.fn(),
  loadMoreThreads: vi.fn(),
  loadMoreMessages: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: ReactNode }) =>
    remote.authenticated ? children : null,
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    remote.authenticated ? null : children,
  AuthLoading: () => null,
  useConvexAuth: () => ({ isAuthenticated: remote.authenticated, isLoading: false }),
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribeToQueries, () => remote.revision);
    const name = getFunctionName(reference);
    remote.queryCalls(name, args);
    if (args === "skip") return undefined;
    if (args && typeof args === "object" && "sessionId" in args) {
      const scopedKey = name + ":" + String(args.sessionId);
      if (remote.queries.has(scopedKey)) return remote.queries.get(scopedKey);
    }
    if (args && typeof args === "object" && "threadId" in args) {
      const scopedKey = name + ":" + String(args.threadId);
      if (remote.queries.has(scopedKey)) return remote.queries.get(scopedKey);
    }
    return remote.queries.get(name);
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference);
    remote.queryCalls(name, args);
    return remote.queries.get(name);
  },
  useAction: (reference: FunctionReference<"action">) => {
    const action = remote.actions.get(getFunctionName(reference));
    if (!action) throw new Error("Unexpected action: " + getFunctionName(reference));
    return action;
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const mutation = remote.mutations.get(getFunctionName(reference));
    if (!mutation) throw new Error("Unexpected mutation: " + getFunctionName(reference));
    return Object.assign(mutation, { withOptimisticUpdate: () => mutation });
  },
}));

vi.mock("@convex-dev/agent/react", () => ({
  optimisticallySendMessage: () => undefined,
  useUIMessages: (reference: FunctionReference<"query">) =>
    remote.queries.get(getFunctionName(reference)),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: remote.signIn }),
}));

function subscribeToQueries(onChange: () => void) {
  remote.subscribers.add(onChange);
  return () => remote.subscribers.delete(onChange);
}

function refreshQueries() {
  act(() => {
    remote.revision += 1;
    for (const notify of remote.subscribers) notify();
  });
}

function scout(id: string, displayName: string, status = "active") {
  return {
    _id: id,
    displayName,
    slug: displayName.toLowerCase(),
    status,
    agentMail: { inboxId: id + "-inbox", address: id + "@example.com" },
    firecrawl: { profileName: id + "-profile" },
  };
}

function session(sessionId: string, sequence: number) {
  return {
    sessionId,
    sequence,
    createdAt: 1,
    provider: "firecrawl",
    profileName: "scout-1-profile",
    viewport: { width: 1280, height: 800 },
    lifecycle: { kind: "active" },
    operationCount: 0,
  };
}

function threadPage(
  results = [
    { threadId: "thread-1", title: "Inspect the form", scoutId: "scout-1", creationTime: 1 },
  ],
) {
  return { results, status: "Exhausted", loadMore: remote.loadMoreThreads };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:https://scout.test/${crypto.randomUUID()}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  remote.authenticated = true;
  remote.queries.clear();
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    userId: "admin",
    role: "role_staff",
    isApproved: false,
    accessKeys: ROLE_ACCESS_GRANTS.role_staff,
  });
  remote.actions.clear();
  remote.mutations.clear();
  window.localStorage.clear();
  remote.queries.set("scout/scouts:list", [
    scout("scout-1", "Conrad"),
    scout("scout-2", "Ada"),
    scout("scout-disabled", "Disabled", "disabled"),
  ]);
  remote.queries.set("scout/chats:listThreads", threadPage());
  remote.queries.set("scout/chats:listMessages", {
    results: [],
    status: "Exhausted",
    loadMore: remote.loadMoreMessages,
  });
  remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
  remote.queries.set("scout/chats:getModelSelection", { model: "qwen/qwen3.7-flash" });
  remote.queries.set("scout/chats:getThreadAgentContext", { instructions: "Chat instructions" });
  remote.queries.set("scout/browserSessions:list", []);
  remote.queries.set("humanHandoffs:forSession", null);
  remote.createThread.mockResolvedValue({ threadId: "thread-created" });
  remote.sendMessage.mockResolvedValue(null);
  remote.saveModelSelection.mockImplementation(
    async (args: FunctionArgs<typeof api.scout.chats.setModelSelection>) => {
      remote.queries.set("scout/chats:getModelSelection:" + args.threadId, args.selection);
      remote.queries.set("scout/chats:getModelSelection:null", args.selection);
      refreshQueries();
      return null;
    },
  );
  remote.stopScout.mockResolvedValue(null);
  remote.executeTool.mockResolvedValue({
    toolCallId: "tool-call-1",
    outcome: { kind: "success", output: "null" },
  });
  remote.getModelCallContext.mockResolvedValue(null);
  remote.listReplayPages.mockResolvedValue({ status: "unavailable" });
  remote.mutations.set("scout/chats:createThread", remote.createThread);
  remote.mutations.set("scout/chats:sendMessage", remote.sendMessage);
  remote.mutations.set("scout/chats:setModelSelection", remote.saveModelSelection);
  remote.mutations.set("scout/chats:stop", remote.stopScout);
  remote.actions.set("scout/manual:executeTool", remote.executeTool);
  remote.actions.set("scout/workspaceTools:executeSiteCommand", vi.fn());
  remote.actions.set("scout/modelCalls:getContext", remote.getModelCallContext);
  remote.actions.set("browserReplay:listPages", remote.listReplayPages);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openChats(path = "/chats?thread=thread-1") {
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () => {
      const pathname = useRouterState({ select: (state) => state.location.pathname });
      return (
        <ScoutSidebarProvider>
          {pathname !== "/" && <AppNavigation />}
          <Outlet />
        </ScoutSidebarProvider>
      );
    },
  });
  const component = ChatsRoute.options.component;
  const validateSearch = ChatsRoute.options.validateSearch;
  const indexComponent = IndexRoute.options.component;
  if (!component || typeof validateSearch !== "function" || !indexComponent) {
    throw new Error("Chat route configuration is missing");
  }
  const chats = createRoute({
    path: "/chats",
    staticData: { access: "access_lab" },
    getParentRoute: () => root,
    component,
    validateSearch,
  });
  const index = createRoute({
    path: "/",
    staticData: { access: "access_public" },
    getParentRoute: () => root,
    component: indexComponent,
  });
  const router = createRouter({
    routeTree: root.addChildren([chats, index]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

describe("Chat workspace", () => {
  function mockWorkspaceFiles() {
    remote.queries.set("scout/workspaces:list", {
      configured: true,
      cwd: "/workspace",
      revision: 1,
      entries: ["first.txt", "second file.txt"].map((name) => ({
        kind: "file",
        path: `/workspace/${name}`,
        key: name,
        size: 10,
        sha256: "hash",
        mode: 420,
        mtime: 0,
      })),
    });
    remote.actions.set(
      "scout/workspaceTools:readFile",
      vi.fn().mockImplementation(({ path }: { path: string }) =>
        Promise.resolve({
          path,
          text: `Contents of ${path}`,
          bytes: new TextEncoder().encode(`Contents of ${path}`).buffer,
        }),
      ),
    );
  }

  test("restores workspace and file views through Back, Forward, and a fresh page load", async () => {
    mockWorkspaceFiles();
    const router = await openChats();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Workspace" }));
    expect(router.state.location.search.view).toBe("workspace");
    await user.click(screen.getByRole("button", { name: "first.txt" }));
    expect((await screen.findByLabelText("File contents")).textContent).toContain("first.txt");
    await user.click(screen.getByRole("button", { name: "second file.txt" }));
    await waitFor(() =>
      expect(screen.getByLabelText("File contents").textContent).toContain("second file.txt"),
    );
    expect(router.state.location.search.file).toBe("/workspace/second file.txt");
    const bookmark = router.state.location.href;

    act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByLabelText("File contents").textContent).toContain("first.txt"),
    );
    act(() => router.history.back());
    await screen.findByText("Select a file to preview it.");
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull());
    act(() => router.history.forward());
    expect(await screen.findByRole("region", { name: "Workspace" })).toBeTruthy();
    cleanup();
    const reloaded = await openChats(bookmark);
    expect((await screen.findByLabelText("File contents")).textContent).toContain(
      "second file.txt",
    );
    expect(reloaded.state.location.search.file).toBe("/workspace/second file.txt");
  });

  test("keeps a deep-linked file selected when canonicalizing the browser session", async () => {
    mockWorkspaceFiles();
    remote.queries.set("scout/browserSessions:list", [session("session-1", 1)]);
    const router = await openChats(
      "/chats?thread=thread-1&view=workspace&file=%2Fworkspace%2Ffirst.txt",
    );
    expect((await screen.findByLabelText("File contents")).textContent).toContain("first.txt");
    await waitFor(() => expect(router.state.location.search.session).toBe("session-1"));
    expect(router.state.location.search.view).toBe("workspace");
    expect(router.state.location.search.file).toBe("/workspace/first.txt");
  });

  test("clears workspace selection for another chat and restores it on Back", async () => {
    mockWorkspaceFiles();
    remote.queries.set(
      "scout/chats:listThreads",
      threadPage([
        { threadId: "thread-1", title: "First chat", scoutId: "scout-1", creationTime: 1 },
        { threadId: "thread-2", title: "Second chat", scoutId: "scout-2", creationTime: 2 },
      ]),
    );
    const router = await openChats(
      "/chats?thread=thread-1&view=workspace&file=%2Fworkspace%2Ffirst.txt",
    );
    await screen.findByLabelText("File contents");
    await userEvent.setup().click(screen.getByRole("link", { name: /Second chat/ }));
    expect(router.state.location.search).toEqual({ thread: "thread-2" });
    expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull();
    act(() => router.history.back());
    expect((await screen.findByLabelText("File contents")).textContent).toContain("first.txt");
    expect(router.state.location.search.thread).toBe("thread-1");
  });

  test("does not add history entries when resizing panes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1440, 900),
    );
    mockWorkspaceFiles();
    const router = await openChats();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Workspace" }));
    const originalUrl = router.state.location.href;
    const historyLength = router.history.length;
    const resize = screen.getByRole("separator", { name: "Resize chat navigation" });
    const originalWidth = resize.getAttribute("aria-valuenow");
    resize.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(resize.getAttribute("aria-valuenow")).not.toBe(originalWidth);
    expect(router.state.location.href).toBe(originalUrl);
    expect(router.history.length).toBe(historyLength);
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull());
  });

  test("navigates to the new-chat form and back without creating a chat", async () => {
    const router = await openChats();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New chat" }));
    expect(router.state.location.search.view).toBe("new");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    act(() => router.history.back());
    expect(await screen.findByRole("button", { name: "New chat" })).toBeTruthy();
    act(() => router.history.forward());
    expect(await screen.findByRole("button", { name: "Close" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test("restores desktop panes from history instead of their last saved visibility", async () => {
    mockWorkspaceFiles();
    const router = await openChats("/chats?thread=thread-1&view=workspace");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Hide chats" }));
    expect(router.state.location.search.chats).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "Hide workspace" }));
    expect(router.state.location.search.inspector).toBe("hidden");
    act(() => router.history.back());
    await screen.findByRole("button", { name: "Hide workspace" });
    expect(screen.getByRole("button", { name: "Show chats" })).toBeTruthy();
    act(() => router.history.back());
    await screen.findByRole("button", { name: "Hide chats" });
    act(() => router.history.forward());
    await screen.findByRole("button", { name: "Show chats" });
    cleanup();
    await openChats("/chats?thread=thread-1&view=workspace");
    expect(await screen.findByRole("button", { name: "Hide chats" })).toBeTruthy();
  });

  test("restores mobile navigation, workspace, and conversation panes", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    mockWorkspaceFiles();
    const router = await openChats("/chats?thread=thread-1&view=workspace");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Show chats" }));
    expect(router.state.location.search.pane).toBe("left");
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(router.state.location.search.pane).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Show chat" }));
    expect(router.state.location.search.pane).toBe("main");
    act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Workspace" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    act(() => router.history.back());
    expect(await screen.findByRole("button", { name: "Hide chats" })).toBeTruthy();
    act(() => router.history.forward());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Workspace" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });

  test("restores context and terminal disclosures without putting drafts in the URL", async () => {
    mockWorkspaceFiles();
    const router = await openChats("/chats?thread=thread-1&view=workspace");
    const user = userEvent.setup();
    const composer = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message Scout",
    });
    const originalUrl = router.state.location.href;
    await user.type(composer, "A private draft");
    expect(router.state.location.href).toBe(originalUrl);
    await user.click(screen.getByText("Agent context"));
    expect(router.state.location.search.context).toBe("open");
    await user.click(screen.getByText("Terminal"));
    expect(router.state.location.search.terminal).toBe("hidden");
    act(() => router.history.back());
    await waitFor(() => expect(screen.getByText("Terminal").closest("details")?.open).toBe(true));
    act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByText("Agent context").closest("details")?.open).toBe(false),
    );
    expect(composer.value).toBe("A private draft");
  });

  test("opens the file workspace beside the existing conversation and runs a command", async () => {
    remote.queries.set("scout/workspaces:list", {
      configured: true,
      cwd: "/workspace",
      revision: 0,
      entries: [],
    });
    remote.executeTool.mockResolvedValue({
      toolCallId: "bash-call",
      outcome: {
        kind: "success",
        output: JSON.stringify({
          stdout: "hello\n",
          stderr: "",
          exitCode: 0,
          cwd: "/workspace",
          revision: 1,
        }),
      },
    });
    await openChats();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("region", { name: "Conversation" })).toBeTruthy();
    await user.type(screen.getByLabelText("Bash command"), "echo hello");
    await user.click(screen.getByRole("button", { name: "Run command" }));
    await waitFor(() =>
      expect(remote.executeTool).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          toolName: "bash",
          input: '{"command":"echo hello"}',
        }),
      ),
    );
    expect(
      await within(screen.getByRole("log", { name: "Terminal output" })).findByText("hello"),
    ).toBeTruthy();
    expect(screen.getByText("Exit 0")).toBeTruthy();
    expect(screen.getByLabelText("Bash command").textContent).toBe("");
  });

  test("downloads the previewed bytes without expiry, treats HTML as text, and releases the URL on close", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    remote.queries.set("scout/workspaces:list", {
      configured: true,
      cwd: "/workspace",
      revision: 1,
      entries: [
        { kind: "directory", path: "/workspace", mode: 493, mtime: 0 },
        {
          kind: "file",
          path: "/workspace/report.html",
          key: "private-key",
          size: 20,
          sha256: "hash",
          mode: 420,
          mtime: 0,
        },
      ],
    });
    remote.actions.set(
      "scout/workspaceTools:readFile",
      vi.fn().mockResolvedValue({
        path: "/workspace/report.html",
        text: "<script>bad()</script>",
        bytes: new TextEncoder().encode("<script>bad()</script>").buffer,
      }),
    );
    await openChats();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "report.html" }));
    expect((await screen.findByLabelText("File contents")).textContent).toBe(
      "<script>bad()</script>",
    );
    expect(screen.getByLabelText("File contents").querySelector("script")).toBeNull();
    const download = screen.getByRole("link", { name: "Download" });
    const url = download.getAttribute("href");
    expect(url).toMatch(/^blob:/);
    expect(download.getAttribute("download")).toBe("report.html");
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) throw new Error("Expected a downloadable Blob");
    expect(blob.type).toBe("application/octet-stream");
    expect(await blob.text()).toBe("<script>bad()</script>");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1_000);
    expect(download.getAttribute("href")).toBe(url);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    cleanup();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
  });

  test("disables the terminal with an actionable message when storage is missing", async () => {
    remote.queries.set("scout/workspaces:list", {
      configured: false,
      cwd: "/workspace",
      revision: 0,
      entries: [],
    });
    await openChats();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("status").textContent).toContain("Connect R2 storage");
    expect(screen.getByRole("button", { name: "Run command" }).hasAttribute("disabled")).toBe(true);
    expect(remote.executeTool).not.toHaveBeenCalled();
  });

  test("shows the public landing at the root without redirecting to sign-in", async () => {
    remote.authenticated = false;
    remote.queries.set("accounts:currentViewerAccess", { kind: "anonymous" });
    remote.queries.set("scout/activity:list", { results: [], status: "Exhausted" });
    const router = await openChats("/");

    expect(await screen.findByRole("heading", { name: "What are we doing today?" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("link", { name: "Play a game" }).getAttribute("href")).toBe("/play");
    expect(screen.getByRole("link", { name: "Review a product" }).getAttribute("href")).toBe(
      "/review",
    );
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(remote.queryCalls).toHaveBeenCalledWith("scout/activity:list", {
      kind: "all",
      scope: "public",
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Review" }));
    expect(remote.queryCalls).toHaveBeenLastCalledWith("scout/activity:list", {
      kind: "review",
      scope: "public",
    });
  });

  test("retains the existing lab sign-in form at chats", async () => {
    remote.authenticated = false;
    const router = await openChats("/chats");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/chats");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Lab" })).toBeNull();
  });

  test("shows a flat chat history and only the current primary navigation", async () => {
    await openChats();

    const navigation = await screen.findByRole("navigation", { name: "Primary navigation" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Activity", "Play", "Review", "Agents", "Lab", "Scouts", "Sites", "Members"]);
    const history = screen.getByRole("navigation", { name: "Chats" });
    expect(within(history).getAllByRole("list")).toHaveLength(1);
    expect(within(history).getByRole("link").getAttribute("href")).toBe("/chats?thread=thread-1");
    expect(screen.queryByText(/experiment|ungrouped|products/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Live|Replay|Transcript)$/ })).toBeNull();
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(conversation.closest('[data-pane-side="main"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /conversation/i })).toBeNull();
  });

  test("creates a chat with only the chosen active Scout", async () => {
    const user = userEvent.setup();
    const router = await openChats();
    await user.click(await screen.findByRole("button", { name: "New chat" }));

    const scoutSelect = screen.getByRole("combobox", { name: "Scout" });
    expect(within(scoutSelect).queryByRole("option", { name: /Disabled/ })).toBeNull();
    expect(screen.queryByLabelText(/product|objective|name/i)).toBeNull();
    await user.selectOptions(scoutSelect, "scout-2");
    await user.click(screen.getByRole("button", { name: "Create chat" }));

    expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({ scoutId: "scout-2" });
    await waitFor(() => expect(router.state.location.search).toEqual({ thread: "thread-created" }));
    expect(screen.getByRole("textbox", { name: "Message Scout" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  test.each(["openai/gpt-5.6-luna", "deepseek/deepseek-v4-flash-0731"])(
    "sends a prompt through %s on the selected chat",
    async (model) => {
      const user = userEvent.setup();
      await openChats();
      await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), model);
      await user.type(
        screen.getByRole("textbox", { name: "Message Scout" }),
        "Inspect the submit button",
      );
      await user.click(screen.getByRole("button", { name: "Send message" }));

      expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
        threadId: "thread-1",
        selection: { model },
        prompt: "Inspect the submit button",
      });
    },
  );

  test.each(["none", "max"])("saves the selected Luna effort %s before sending", async (effort) => {
    const user = userEvent.setup();
    await openChats();
    const driver = await screen.findByRole("combobox", { name: "Driver" });
    expect(screen.queryByRole("combobox", { name: "Effort" })).toBeNull();
    await user.selectOptions(driver, "openai/gpt-5.6-luna");
    const picker = screen.getByRole<HTMLSelectElement>("combobox", { name: "Effort" });
    expect(picker.value).toBe("default");
    await user.selectOptions(picker, effort);
    expect(remote.saveModelSelection).toHaveBeenLastCalledWith({
      threadId: "thread-1",
      selection: { model: "openai/gpt-5.6-luna", reasoningEffort: effort },
    });
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Effort" }).value).toBe(effort);
    await user.type(screen.getByRole("textbox", { name: "Message Scout" }), "Inspect the form");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      selection: { model: "openai/gpt-5.6-luna", reasoningEffort: effort },
      prompt: "Inspect the form",
    });
  });

  test("includes the selected effort when replacing a running Luna turn", async () => {
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Driver" }),
      "openai/gpt-5.6-luna",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Effort" }), "max");
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "running",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    refreshQueries();
    await user.type(screen.getByRole("textbox", { name: "Message Scout" }), "Try another approach");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(remote.stopScout).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      replacement: {
        model: "openai/gpt-5.6-luna",
        reasoningEffort: "max",
        prompt: "Try another approach",
      },
    });
  });

  test("restores saved model and effort after remounting and switches between chat choices", async () => {
    remote.queries.set(
      "scout/chats:listThreads",
      threadPage([
        { threadId: "thread-1", title: "Luna chat", scoutId: "scout-1", creationTime: 1 },
        { threadId: "thread-2", title: "DeepSeek chat", scoutId: "scout-2", creationTime: 2 },
      ]),
    );
    remote.queries.set("scout/chats:getModelSelection:thread-1", {
      model: "openai/gpt-5.6-luna",
      reasoningEffort: "max",
    });
    remote.queries.set("scout/chats:getModelSelection:thread-2", {
      model: "deepseek/deepseek-v4-flash-0731",
    });
    const router = await openChats();
    expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Driver" })).value).toBe(
      "openai/gpt-5.6-luna",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Effort" }).value).toBe("max");
    await act(() => router.navigate({ to: "/chats", search: { thread: "thread-2" } }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Driver" }).value).toBe(
      "deepseek/deepseek-v4-flash-0731",
    );
    expect(screen.queryByRole("combobox", { name: "Effort" })).toBeNull();
    cleanup();
    await openChats();
    expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Driver" })).value).toBe(
      "openai/gpt-5.6-luna",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Effort" }).value).toBe("max");
    expect(remote.saveModelSelection).not.toHaveBeenCalled();
  });

  test("waits for the requested chat and saved settings before selecting a model", async () => {
    remote.queries.set("scout/chats:listThreads", {
      ...threadPage([]),
      status: "LoadingFirstPage",
    });
    await openChats();
    const driver = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Driver" });
    expect(driver.value).toBe("");
    expect(driver.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(true);
    remote.queries.delete("scout/chats:getModelSelection");
    remote.queries.set("scout/chats:listThreads", threadPage());
    refreshQueries();
    expect(driver.value).toBe("");
    expect(driver.disabled).toBe(true);
    remote.queries.set("scout/chats:getModelSelection:thread-1", {
      model: "openai/gpt-5.6-luna",
      reasoningEffort: "high",
    });
    refreshQueries();
    expect(driver.value).toBe("openai/gpt-5.6-luna");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Effort" }).value).toBe("high");
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("keeps Manual temporary and reports a failed preference save", async () => {
    const user = userEvent.setup();
    await openChats();
    const driver = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Driver" });
    await user.selectOptions(driver, "manual");
    expect(driver.value).toBe("manual");
    expect(remote.saveModelSelection).not.toHaveBeenCalled();
    cleanup();
    await openChats();
    const restored = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Driver" });
    expect(restored.value).toBe("qwen/qwen3.7-flash");
    remote.saveModelSelection.mockRejectedValueOnce(new Error("Network unavailable"));
    await user.selectOptions(restored, "openai/gpt-5.6-luna");
    expect(await screen.findByText("Model selection could not be saved.")).toBeTruthy();
    expect(restored.value).toBe("qwen/qwen3.7-flash");
    expect(restored.disabled).toBe(false);
  });

  test("stops the selected chat when the running composer is empty", async () => {
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "running",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const user = userEvent.setup();
    await openChats();

    expect(screen.getByRole("textbox", { name: "Message Scout" }).hasAttribute("disabled")).toBe(
      false,
    );
    await user.click(await screen.findByRole("button", { name: "Stop Scout" }));

    expect(remote.stopScout).toHaveBeenCalledExactlyOnceWith({ threadId: "thread-1" });
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("stops the selected chat and persists one replacement with the stop", async () => {
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "running",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const user = userEvent.setup();
    await openChats();
    await user.type(
      screen.getByRole("textbox", { name: "Message Scout" }),
      "Use the existing account instead",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(remote.stopScout).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      replacement: {
        model: "qwen/qwen3.7-flash",
        prompt: "Use the existing account instead",
      },
    });
    expect(remote.sendMessage).not.toHaveBeenCalled();

    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "stopping",
      threadId: "thread-1",
      turnId: "turn-1",
      retryable: false,
    });
    refreshQueries();
    expect(remote.sendMessage).not.toHaveBeenCalled();

    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "running",
      threadId: "thread-1",
      turnId: "turn-2",
    });
    refreshQueries();
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Scout" })).not.toBeNull());
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("shows a browser cleanup failure and lets the user retry Stop", async () => {
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "stopping",
      threadId: "thread-1",
      turnId: "turn-1",
      retryable: true,
      failure: "Firecrawl did not stop the browser session",
    });
    const user = userEvent.setup();
    await openChats();

    expect(screen.getByRole("alert").textContent).toContain(
      "Browser cleanup failed: Firecrawl did not stop the browser session",
    );
    await user.click(screen.getByRole("button", { name: "Retry stopping Scout" }));
    expect(remote.stopScout).toHaveBeenCalledExactlyOnceWith({ threadId: "thread-1" });
  });

  test("keeps manual browser execution and validates its JSON input", async () => {
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "browser_execute");
    const toolInput = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Tool input" });
    expect(toolInput.value).toBe(JSON.stringify({ code: BROWSER_EXECUTE_EXAMPLE }, null, 2));
    fireEvent.change(toolInput, { target: { value: "invalid JSON" } });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    expect(screen.getByRole("alert").textContent).toBe("Tool input must be valid JSON.");
    expect(remote.executeTool).not.toHaveBeenCalled();

    const input = { code: "return await page.title()" };
    fireEvent.change(toolInput, { target: { value: JSON.stringify(input) } });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() =>
      expect(remote.executeTool).toHaveBeenCalledExactlyOnceWith({
        threadId: "thread-1",
        toolName: "browser_execute",
        input: JSON.stringify(input),
        operationId: expect.any(String),
      }),
    );
  });

  test.each([
    { toolName: "web_search", input: { query: "form builder pricing" } },
    { toolName: "web_read", input: { url: "https://example.com" } },
    { toolName: "web_map", input: { url: "https://example.com" } },
    { toolName: "web_crawl", input: { url: "https://example.com", limit: 5 } },
    {
      toolName: "send_message",
      input: { to: "person@gmail.com", subject: "Hello", text: "A note from Scout." },
    },
    {
      toolName: "reply_to_message",
      input: { messageId: "message-1", text: "Thanks for the update." },
    },
    {
      toolName: "prepare_account_password",
      input: {
        serviceName: "Example",
        serviceDomain: "example.com",
        identifier: "scout-1@example.com",
      },
    },
    {
      toolName: "record_authenticated_service_account",
      input: {
        accountAccess: "recovered",
        loginMethod: "managed_password",
        identifier: "scout-1@example.com",
      },
    },
  ])("runs $toolName from the manual picker", async ({ toolName, input }) => {
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), toolName);
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: { value: JSON.stringify(input) },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() =>
      expect(remote.executeTool).toHaveBeenCalledExactlyOnceWith({
        threadId: "thread-1",
        toolName,
        input: JSON.stringify(input),
        operationId: expect.any(String),
      }),
    );
  });

  test("reuses the manual email operation after reload and provider-equivalent normalization", async () => {
    remote.executeTool.mockRejectedValueOnce(new Error("response lost"));
    let user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "send_message");
    const input = {
      to: " person@gmail.com ",
      subject: "Hello ",
      text: "A note from Scout. ",
    };
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: { value: JSON.stringify(input) },
    });

    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await screen.findByRole("alert");

    cleanup();
    user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "send_message");
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: {
        value: JSON.stringify(
          {
            text: input.text.trim(),
            to: input.to.trim(),
            subject: input.subject.trim(),
          },
          null,
          2,
        ),
      },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));

    await waitFor(() => expect(remote.executeTool).toHaveBeenCalledTimes(2));
    const firstCall = remote.executeTool.mock.calls[0]?.[0];
    const secondCall = remote.executeTool.mock.calls[1]?.[0];
    expect(firstCall).toMatchObject({ operationId: expect.any(String) });
    expect(secondCall?.operationId).toBe(firstCall?.operationId);
    expect(JSON.parse(secondCall?.input)).toEqual({
      text: input.text.trim(),
      to: input.to.trim(),
      subject: input.subject.trim(),
    });
  });

  test("reuses a manual reply operation for trim-equivalent input", async () => {
    remote.executeTool.mockRejectedValueOnce(new Error("response lost"));
    let user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "reply_to_message");
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: {
        value: JSON.stringify({ messageId: " message-1 ", text: " Thanks for the update. " }),
      },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await screen.findByRole("alert");

    cleanup();
    user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "reply_to_message");
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: {
        value: JSON.stringify({ messageId: "message-1", text: "Thanks for the update." }, null, 2),
      },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));

    await waitFor(() => expect(remote.executeTool).toHaveBeenCalledTimes(2));
    expect(remote.executeTool.mock.calls[1]?.[0].operationId).toBe(
      remote.executeTool.mock.calls[0]?.[0].operationId,
    );
  });

  test("preserves an unresolved email operation while another thread sends", async () => {
    remote.queries.set("scout/chats:listThreads", {
      ...threadPage(),
      results: [
        { threadId: "thread-1", title: "First", scoutId: "scout-1", creationTime: 1 },
        { threadId: "thread-2", title: "Second", scoutId: "scout-1", creationTime: 2 },
      ],
    });
    remote.executeTool
      .mockRejectedValueOnce(new Error("first response lost"))
      .mockRejectedValueOnce(new Error("second response lost"));
    const input = JSON.stringify({
      to: "person@gmail.com",
      subject: "Hello",
      text: "A note from Scout.",
    });

    for (const [index, threadId] of ["thread-1", "thread-2", "thread-1"].entries()) {
      const user = userEvent.setup();
      await openChats(`/chats?thread=${threadId}`);
      await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
      await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "send_message");
      fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
        target: { value: input },
      });
      await user.click(screen.getByRole("button", { name: "Run tool" }));
      await waitFor(() => expect(remote.executeTool).toHaveBeenCalledTimes(index + 1));
      cleanup();
    }

    const firstOperationId = remote.executeTool.mock.calls[0]?.[0].operationId;
    expect(remote.executeTool.mock.calls[1]?.[0].operationId).not.toBe(firstOperationId);
    expect(remote.executeTool.mock.calls[2]?.[0].operationId).toBe(firstOperationId);
  });

  test("blocks an unresolved email retry after AgentMail's 24-hour idempotency window", async () => {
    remote.executeTool.mockRejectedValueOnce(new Error("response lost"));
    let user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "send_message");
    const toolInput = screen.getByRole("textbox", { name: "Tool input" });
    fireEvent.change(toolInput, {
      target: {
        value: JSON.stringify({
          to: "person@gmail.com",
          subject: "Hello",
          text: "A note from Scout.",
        }),
      },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await screen.findByRole("alert");

    const storageKey = window.localStorage.key(0);
    if (!storageKey) throw new Error("Pending manual email was not persisted");
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!Array.isArray(stored) || typeof stored[0] !== "object" || stored[0] === null) {
      throw new Error("Pending manual email has an invalid test shape");
    }
    Object.assign(stored[0], { createdAt: Date.now() - 24 * 60 * 60 * 1_000 });
    window.localStorage.setItem(storageKey, JSON.stringify(stored));

    cleanup();
    user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tool" }), "send_message");
    fireEvent.change(screen.getByRole("textbox", { name: "Tool input" }), {
      target: {
        value: JSON.stringify({
          to: "person@gmail.com",
          subject: "Hello",
          text: "A note from Scout.",
        }),
      },
    });
    await user.click(screen.getByRole("button", { name: "Run tool" }));

    expect((await screen.findByRole("alert")).textContent).toContain("older than 24 hours");
    expect(remote.executeTool).toHaveBeenCalledOnce();

    const firstOperationId = remote.executeTool.mock.calls[0]?.[0].operationId;
    await user.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() => expect(remote.executeTool).toHaveBeenCalledTimes(2));
    expect(remote.executeTool.mock.calls[1]?.[0].operationId).not.toBe(firstOperationId);
  });

  test("submits a manual operation only once while its fingerprint is being prepared", async () => {
    let finish:
      | ((result: { toolCallId: string; outcome: { kind: "success"; output: string } }) => void)
      | undefined;
    remote.executeTool.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Driver" }), "manual");
    const runTool = screen.getByRole("button", { name: "Run tool" });
    const form = runTool.closest("form");
    if (!form) throw new Error("Manual composer form not found");

    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(remote.executeTool).toHaveBeenCalledOnce());
    finish?.({ toolCallId: "tool-call-1", outcome: { kind: "success", output: "null" } });
  });

  test("preserves the agent instructions and keyboard-resizable context panel", async () => {
    const user = userEvent.setup();
    await openChats();
    await user.click(await screen.findByText("Agent context"));
    expect(screen.getByText("Chat instructions")).toBeTruthy();
    const toolDescription = screen.getByRole("heading", {
      name: "browser_execute",
    }).nextElementSibling;
    expect(toolDescription?.textContent).toBe(BROWSER_EXECUTE_DESCRIPTION);
    const resize = screen.getByRole("separator", { name: "Resize agent context" });
    expect(resize.getAttribute("aria-valuenow")).toBe("288");
    fireEvent.keyDown(resize, { key: "ArrowUp" });
    expect(resize.getAttribute("aria-valuenow")).toBe("336");
    for (let step = 0; step < 8; step += 1) fireEvent.keyDown(resize, { key: "ArrowDown" });
    expect(resize.getAttribute("aria-valuenow")).toBe("144");
  });

  test("loads a selected SDK model input on demand and preserves the draft", async () => {
    const summary = {
      modelCallId: "model-call-1",
      sequence: 1,
      provider: "openrouter",
      modelId: "qwen/qwen3.7-flash",
      startedAt: 1,
      messageCount: 2,
      toolCount: 1,
      compactedBrowserSnapshotCount: 0,
      serializedBytes: 512,
      state: {
        kind: "completed",
        finishedAt: 2,
        finishReason: "tool-calls",
        usage: {
          promptTokens: 4_428,
          completionTokens: 87,
          totalTokens: 4_515,
          reasoningTokens: 55,
          cachedInputTokens: 0,
          costUsd: 0.00014415,
        },
      },
    };
    remote.queries.set("scout/chats:listMessages", {
      results: [
        {
          id: "message-1",
          _creationTime: 1,
          key: "message-1",
          order: 1,
          stepOrder: 0,
          status: "success",
          role: "assistant",
          parts: [{ type: "text", text: "Inspected the page." }],
          text: "Inspected the page.",
          metadata: {
            turnId: "turn-1",
            model: "qwen/qwen3.7-flash",
            scout: { id: "scout-1", displayName: "Conrad" },
            outcome: { kind: "completed" },
          },
        },
      ],
      status: "Exhausted",
      loadMore: remote.loadMoreMessages,
    });
    remote.queries.set("scout/modelCalls:listForTurn", [summary]);
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    remote.getModelCallContext.mockResolvedValue({
      summary,
      compaction: {
        checkpoint: {
          _id: "compaction-1",
          _creationTime: 1,
          threadId: "thread-1",
          modelCallId: "summary-call",
          previousCompactionId: null,
          summary: "Created app-123. Deployment is still pending. Do not send email.",
          coveredThrough: { messageId: "covered-message", order: 0, stepOrder: 13 },
          coveredMessageCount: 14,
          beforeTokens: 32_500,
          afterTokens: 11_200,
        },
        call: {
          ...summary,
          state: {
            kind: "completed",
            finishedAt: 2,
            finishReason: "stop",
            usage: { costUsd: 0.004 },
          },
        },
      },
      snapshot: JSON.stringify({
        version: 1,
        instructions: "Inspect carefully.",
        messages: [{ role: "user", content: [{ type: "text", text: "Inspect this." }] }],
        tools: [{ name: "browser_execute", description: "Use Playwright." }],
        settings: { temperature: 0 },
      }),
    });
    const user = userEvent.setup();
    const router = await openChats();
    await screen.findByTitle("Live browser session 1");
    await waitFor(() => expect(router.state.location.search.session).toBe("session-1"));
    const composer = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message Scout",
    });
    await user.type(composer, "Keep this unfinished message");

    expect(remote.queryCalls).not.toHaveBeenCalledWith("scout/modelCalls:listForTurn", {
      turnId: "turn-1",
    });
    expect(remote.getModelCallContext).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Model calls" }));
    const call = await screen.findByRole("button", { name: /Call 1/ });
    expect(remote.queryCalls).toHaveBeenCalledWith("scout/modelCalls:listForTurn", {
      turnId: "turn-1",
    });
    expect(remote.getModelCallContext).not.toHaveBeenCalled();

    await user.click(call);
    expect(await screen.findByRole("region", { name: "SDK model input" })).toBeTruthy();
    expect(remote.getModelCallContext).toHaveBeenCalledExactlyOnceWith({
      modelCallId: "model-call-1",
      threadId: "thread-1",
    });
    expect(screen.queryByText("Inspect carefully.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Instructions" }));
    expect(screen.getByText("Inspect carefully.")).toBeTruthy();
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(conversation.closest('[data-pane-side="main"]')).not.toBeNull();
    expect(
      screen.getByRole("region", { name: "SDK model input" }).closest('[data-pane-side="right"]'),
    ).not.toBeNull();
    expect(screen.getByRole("region", { name: "Conversation summary" })).toBeTruthy();
    expect(
      screen.getByText("Created app-123. Deployment is still pending. Do not send email."),
    ).toBeTruthy();
    expect(screen.getByText(/Covers 14 earlier messages/)).toBeTruthy();
    expect(screen.getByText("32,500 estimated tokens")).toBeTruthy();
    expect(screen.getByText("11,200 estimated tokens")).toBeTruthy();
    expect(screen.getByText("$0.004")).toBeTruthy();
    expect(screen.getByText("Through message covered-message")).toBeTruthy();
    expect(screen.getByText("4,428")).toBeTruthy();
    expect(screen.getByText("4,515")).toBeTruthy();
    expect(screen.getByText("$0.000144")).toBeTruthy();
    expect(screen.queryByText("Use Playwright.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Tools 1" }));
    await user.click(screen.getByRole("button", { name: "1 · browser_execute" }));
    expect(screen.getByText(/Use Playwright/)).toBeTruthy();
    expect(router.state.location.search).toEqual({
      thread: "thread-1",
      session: "session-1",
      call: "model-call-1",
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("region", { name: "SDK model input" })).toBeNull();
    expect(await screen.findByTitle("Live browser session 1")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "Keep this unfinished message",
    );
    expect(router.state.location.search).toEqual({ thread: "thread-1", session: "session-1" });
  });

  test("shows the live browser beside the conversation and keeps the handoff accessible", async () => {
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    remote.queries.set("humanHandoffs:forSession", {
      handoffId: "handoff-1",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      expiresAt: Date.now() + 60_000,
      status: "available",
    });
    const user = userEvent.setup();
    const router = await openChats();
    const handoff = await screen.findByRole("link", { name: "Open browser handoff" });
    expect(handoff.getAttribute("href")).toBe("/handoff/handoff-1");
    const frame = await screen.findByTitle("Live browser session 1");
    expect(frame.getAttribute("src")).toBe("about:blank#scout-live");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(conversation.closest('[data-pane-side="main"]')).not.toBeNull();
    const pane = frame.closest('[data-pane-side="right"]');
    expect(pane).not.toBeNull();
    expect(pane?.hasAttribute("data-desktop-open")).toBe(true);
    const composer = within(conversation).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message Scout",
    });
    await user.type(composer, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Hide browser" }));
    expect(pane?.hasAttribute("data-desktop-open")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Show browser" }));
    expect(pane?.hasAttribute("data-desktop-open")).toBe(true);
    expect(composer.value).toBe("Keep this draft");
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ thread: "thread-1", session: "session-1" }),
    );
  });

  test("shows an actionable notice when the private handoff link could not be delivered", async () => {
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("humanHandoffs:forSession", {
      handoffId: "handoff-1",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      failedAt: 2,
      status: "failed",
      failure: "delivery_failed",
    });

    await openChats();

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("could not deliver the private handoff link");
    expect(notice.textContent).toContain("Closing the browser");
    expect(screen.queryByRole("link", { name: "Open browser handoff" })).toBeNull();
  });

  test("cancels the current handoff while viewing an older browser and preserves the draft", async () => {
    const oldBrowser = { ...session("session-old", 1), lifecycle: { kind: "closed" } };
    const currentBrowser = session("session-current", 2);
    remote.queries.set("scout/browserSessions:list", [oldBrowser, currentBrowser]);
    remote.queries.set("scout/browserSessions:get:session-old", { ...oldBrowser, operations: [] });
    const handoff = {
      handoffId: "handoff-current",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      expiresAt: Date.now() + 60_000,
      status: "available",
    };
    remote.queries.set("humanHandoffs:forSession:session-current", handoff);
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "handoff",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const user = userEvent.setup();
    await openChats("/chats?thread=thread-1&session=session-old");

    expect(
      (await screen.findByRole("link", { name: "Open browser handoff" })).getAttribute("href"),
    ).toBe("/handoff/handoff-current");
    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" });
    await user.type(composer, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Cancel handoff" }));
    expect(remote.stopScout).toHaveBeenCalledExactlyOnceWith({ threadId: "thread-1" });
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(composer.value).toBe("Keep this draft");

    remote.queries.set("humanHandoffs:forSession:session-current", {
      ...handoff,
      status: "stopped",
    });
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "stopping",
      threadId: "thread-1",
      turnId: "turn-1",
      retryable: false,
    });
    refreshQueries();
    expect(screen.getByText("Handoff canceled.")).not.toBeNull();
    expect(screen.getByText("Closing the browser…")).not.toBeNull();
    expect(composer.disabled).toBe(true);

    remote.queries.set("scout/browserSessions:list", [
      oldBrowser,
      {
        ...currentBrowser,
        lifecycle: { kind: "closed" },
      },
    ]);
    remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
    refreshQueries();
    expect(
      screen.getByText("The browser is closed. Send a new message to continue."),
    ).not.toBeNull();
    expect(composer.disabled).toBe(false);
    expect(composer.value).toBe("Keep this draft");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      false,
    );
    expect(screen.queryByRole("link", { name: "Open browser handoff" })).toBeNull();
  });

  test("shows that an expired handoff has ended and permits a new message", async () => {
    const browser = { ...session("session-1", 1), lifecycle: { kind: "closed" } };
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("humanHandoffs:forSession", {
      handoffId: "handoff-1",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      status: "expired",
    });
    const user = userEvent.setup();
    await openChats();
    expect(screen.getByText("Handoff expired.")).not.toBeNull();
    expect(
      screen.getByText("The browser is closed. Send a new message to continue."),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Open browser handoff" })).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Message Scout" }),
      "Try a different approach",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      prompt: "Try a different approach",
      selection: { model: "qwen/qwen3.7-flash" },
    });
  });

  test("redacts another owner's activity while disabling chat controls", async () => {
    remote.queries.set("scout/chats:getScoutActivity", { kind: "busy" });

    await openChats("/chats?thread=thread-1");

    expect(screen.getByText("Conrad is busy in another chat.")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Open active chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      true,
    );
    expect(document.body.textContent).not.toContain("thread-2");
    expect(document.body.textContent).not.toContain("Firecrawl did not stop the browser session");
    expect(screen.queryByText(/Browser cleanup failed/)).toBeNull();
  });

  test("keeps the Open active chat link for the caller's own other chat", async () => {
    remote.queries.set(
      "scout/chats:listThreads",
      threadPage([
        {
          threadId: "thread-1",
          title: "Inspect the form",
          scoutId: "scout-1",
          creationTime: 1,
        },
        { threadId: "thread-2", title: "Signup", scoutId: "scout-1", creationTime: 2 },
      ]),
    );
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "handoff",
      threadId: "thread-2",
      turnId: "turn-2",
    });

    await openChats("/chats?thread=thread-1");

    expect(screen.getByText("Conrad is busy in another chat.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open active chat" }).getAttribute("href")).toBe(
      "/chats?thread=thread-2",
    );
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
  });

  test("loads the requested closed browser session for replay", async () => {
    const closed = { ...session("session-closed", 1), lifecycle: { kind: "closed", closedAt: 2 } };
    const active = session("session-active", 2);
    remote.queries.set("scout/browserSessions:list", [closed, active]);
    remote.queries.set("scout/browserSessions:get:session-closed", { ...closed, operations: [] });
    remote.queries.set("scout/browserSessions:get:session-active", { ...active, operations: [] });
    const router = await openChats("/chats?thread=thread-1&session=session-closed");

    expect(await screen.findByText("No replay")).toBeTruthy();
    expect(remote.listReplayPages).toHaveBeenCalledExactlyOnceWith({ sessionId: "session-closed" });
    expect(router.state.location.search).toEqual({
      thread: "thread-1",
      session: "session-closed",
    });
    expect(screen.getByRole("textbox", { name: "Message Scout" })).toBeTruthy();
    expect(screen.queryByTitle("Live browser session 2")).toBeNull();
  });

  test("switches from live to replay when a session closes without losing the draft", async () => {
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    const user = userEvent.setup();
    await openChats();
    await screen.findByTitle("Live browser session 1");
    await user.type(screen.getByRole("textbox", { name: "Message Scout" }), "My next message");
    await user.click(screen.getByText("Agent context"));

    const closed = { ...browser, lifecycle: { kind: "closed", closedAt: 2 } };
    remote.queries.set("scout/browserSessions:list", [closed]);
    remote.queries.set("scout/browserSessions:get", { ...closed, operations: [] });
    refreshQueries();

    expect(await screen.findByText("No replay")).toBeTruthy();
    expect(screen.queryByTitle("Live browser session 1")).toBeNull();
    expect(remote.listReplayPages).toHaveBeenCalledExactlyOnceWith({ sessionId: "session-1" });
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "My next message",
    );
    expect(screen.getByText("Agent context").closest("details")?.open).toBe(true);
  });

  test("selects a new browser session and keeps manual session choices in the URL", async () => {
    const closed = { ...session("session-1", 1), lifecycle: { kind: "closed", closedAt: 2 } };
    remote.queries.set("scout/browserSessions:list", [closed]);
    remote.queries.set("scout/browserSessions:get:session-1", { ...closed, operations: [] });
    remote.listReplayPages.mockResolvedValue({
      status: "ready",
      viewport: closed.viewport,
      pages: [
        { pageId: "old-page", pageUrl: "https://first.test", startTimeMs: 0, endTimeMs: 5_000 },
      ],
      operations: [],
    });
    remote.actions.set(
      "browserReplay:loadPlaylist",
      vi.fn().mockResolvedValue({ status: "ready", playlist: "#EXTM3U" }),
    );
    const user = userEvent.setup();
    const router = await openChats();
    await user.click(await screen.findByRole("button", { name: "first.test" }));
    await waitFor(() => expect(router.state.location.search.session).toBe("session-1"));
    expect(router.state.location.search.replayPage).toBe("old-page");
    await user.type(screen.getByRole("textbox", { name: "Message Scout" }), "Continue later");

    const active = session("session-2", 2);
    remote.queries.set("scout/browserSessions:list", [closed, active]);
    remote.queries.set("scout/browserSessions:get:session-2", { ...active, operations: [] });
    remote.queries.set("scout/browserSessions:liveView:session-2", {
      url: "about:blank#scout-live",
    });
    refreshQueries();

    const picker = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "Browser session",
    });
    expect(picker.value).toBe("session-2");
    expect(await screen.findByTitle("Live browser session 2")).toBeTruthy();
    expect(router.state.location.search.session).toBe("session-2");
    expect(router.state.location.search.replayPage).toBeUndefined();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "Continue later",
    );

    await user.selectOptions(picker, "session-1");
    expect(await screen.findByRole("button", { name: "first.test" })).toBeTruthy();
    expect(router.state.location.search.session).toBe("session-1");
  });

  test("restores recorded tabs on Back, Forward, and reload without serializing playback", async () => {
    const closed = { ...session("session-1", 1), lifecycle: { kind: "closed", closedAt: 2 } };
    const active = session("session-2", 2);
    remote.queries.set("scout/browserSessions:list", [closed, active]);
    remote.queries.set("scout/browserSessions:get:session-1", { ...closed, operations: [] });
    remote.queries.set("scout/browserSessions:get:session-2", { ...active, operations: [] });
    remote.queries.set("scout/browserSessions:liveView:session-2", { url: "about:blank#live" });
    remote.listReplayPages.mockResolvedValue({
      status: "ready",
      viewport: closed.viewport,
      pages: [
        { pageId: "page-1", pageUrl: "https://first.test", startTimeMs: 0, endTimeMs: 5_000 },
        { pageId: "page-2", pageUrl: "https://second.test", startTimeMs: 6_000, endTimeMs: 9_000 },
      ],
      operations: [],
    });
    remote.actions.set(
      "browserReplay:loadPlaylist",
      vi.fn().mockResolvedValue({ status: "ready", playlist: "#EXTM3U" }),
    );
    const router = await openChats("/chats?thread=thread-1&session=session-1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "first.test" }));
    expect(router.state.location.search.replayPage).toBe("page-1");
    await user.click(screen.getByRole("button", { name: "second.test" }));
    expect(router.state.location.search.replayPage).toBe("page-2");
    const bookmark = router.state.location.href;
    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Replay position" }).value).toBe(
      "6000",
    );
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), {
      target: { value: "7000" },
    });
    expect(router.state.location.href).toBe(bookmark);
    act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "first.test" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    act(() => router.history.forward());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "second.test" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Follow activity" }));
    expect(router.state.location.search.replayPage).toBeUndefined();
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.search.replayPage).toBe("page-2"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Browser session" }),
      "session-2",
    );
    expect(await screen.findByTitle("Live browser session 2")).toBeTruthy();
    expect(router.state.location.search.replayPage).toBeUndefined();
    cleanup();
    await openChats(bookmark);
    expect(
      (await screen.findByRole("button", { name: "second.test" })).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Replay position" }).value).toBe(
      "6000",
    );
  });

  test("keeps the conversation in the main pane when the first browser appears", async () => {
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Driver" }),
      "openai/gpt-5.6-luna",
    );
    await user.type(screen.getByRole("textbox", { name: "Message Scout" }), "Still typing");
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    refreshQueries();

    expect(await screen.findByTitle("Live browser session 1")).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Conversation" }).closest('[data-pane-side="main"]'),
    ).not.toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "Still typing",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Driver" }).value).toBe(
      "openai/gpt-5.6-luna",
    );
  });

  test("keeps mobile chat selected when a browser arrives and restores pane history", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const user = userEvent.setup();
    const router = await openChats();
    await screen.findByRole("textbox", { name: "Message Scout" });

    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    refreshQueries();

    const showBrowser = await screen.findByRole("button", { name: "Show browser" });
    expect(showBrowser.getAttribute("aria-pressed")).toBe("false");
    await user.click(showBrowser);
    expect(screen.getByRole("button", { name: "Show chat" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(router.state.location.search.pane).toBe("right");
    await user.click(screen.getByRole("button", { name: "Show chat" }));
    expect(router.state.location.search.pane).toBeUndefined();
    act(() => router.history.back());
    await screen.findByRole("button", { name: "Show chat" });
    expect(router.state.location.search.pane).toBe("right");
    act(() => router.history.back());
    await screen.findByRole("button", { name: "Show browser" });
    expect(router.state.location.search.pane).toBeUndefined();
    expect(screen.getByRole("textbox", { name: "Message Scout" })).toBeTruthy();
  });

  test("does not let an unavailable chat receive a message", async () => {
    await openChats("/chats?thread=missing");
    expect(await screen.findByText("Chat not available")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message Scout" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("accepts supported view parameters and discards malformed or unknown values", () => {
    const validateSearch = ChatsRoute.options.validateSearch;
    if (typeof validateSearch !== "function") throw new Error("Chat search validator is missing");
    expect(
      validateSearch({
        thread: "thread-1",
        session: "session-1",
        call: "model-call-1",
        view: "live",
        experiment: "discarded",
      }),
    ).toEqual({ thread: "thread-1", session: "session-1", call: "model-call-1" });
    const view = {
      thread: "thread-1",
      session: "session-1",
      replayPage: "page-1",
      view: "workspace",
      file: "/workspace/report.txt",
      pane: "main",
      chats: "hidden",
      inspector: "hidden",
      context: "open",
      terminal: "hidden",
    };
    expect(validateSearch(view)).toEqual(view);
    expect(
      validateSearch({
        thread: 7,
        session: {},
        replayPage: [],
        view: "product",
        file: "/etc/passwd",
        pane: "unknown",
        chats: "open",
        inspector: false,
        context: true,
        terminal: "open",
      }),
    ).toEqual({});
  });
});
