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
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useSyncExternalStore, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vite-plus/test";
import {
  BROWSER_EXECUTE_DESCRIPTION,
  BROWSER_EXECUTE_EXAMPLE,
  BROWSER_STATE_HELPER_SOURCE,
} from "../../convex/scout/browserToolContract";
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
  createThread: vi.fn(),
  sendMessage: vi.fn(),
  executeTool: vi.fn(),
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
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribeToQueries, () => remote.revision);
    if (args === "skip") return undefined;
    const name = getFunctionName(reference);
    if (args && typeof args === "object" && "sessionId" in args) {
      const scopedKey = name + ":" + String(args.sessionId);
      if (remote.queries.has(scopedKey)) return remote.queries.get(scopedKey);
    }
    return remote.queries.get(name);
  },
  usePaginatedQuery: (reference: FunctionReference<"query">) =>
    remote.queries.get(getFunctionName(reference)),
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
  remote.authenticated = true;
  remote.queries.clear();
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
  remote.queries.set("scout/chats:getScoutActivity", { active: false });
  remote.queries.set("scout/chats:getThreadAgentContext", { instructions: "Chat instructions" });
  remote.queries.set("scout/browserSessions:list", []);
  remote.queries.set("humanHandoffs:active", null);
  remote.createThread.mockResolvedValue({ threadId: "thread-created" });
  remote.sendMessage.mockResolvedValue(null);
  remote.executeTool.mockResolvedValue({
    toolCallId: "tool-call-1",
    outcome: { kind: "success", output: "null" },
  });
  remote.listReplayPages.mockResolvedValue({ status: "unavailable" });
  remote.mutations.set("scout/chats:createThread", remote.createThread);
  remote.mutations.set("scout/chats:sendMessage", remote.sendMessage);
  remote.actions.set("scout/manual:executeTool", remote.executeTool);
  remote.actions.set("browserReplay:listPages", remote.listReplayPages);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openChats(path = "/chats?thread=thread-1") {
  const root = createRootRoute({
    component: () => (
      <ScoutSidebarProvider>
        {remote.authenticated ? <AppNavigation /> : null}
        <Outlet />
      </ScoutSidebarProvider>
    ),
  });
  const component = ChatsRoute.options.component;
  const validateSearch = ChatsRoute.options.validateSearch;
  const beforeLoad = IndexRoute.options.beforeLoad;
  if (!component || typeof validateSearch !== "function" || typeof beforeLoad !== "function") {
    throw new Error("Chat route configuration is missing");
  }
  const chats = createRoute({
    path: "/chats",
    getParentRoute: () => root,
    component,
    validateSearch,
  });
  const index = createRoute({
    path: "/",
    getParentRoute: () => root,
    beforeLoad,
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
  test("opens chats at the root and retains the existing sign-in form", async () => {
    remote.authenticated = false;
    const router = await openChats("/");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/chats");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("shows a flat chat history and only the current primary navigation", async () => {
    await openChats();

    const navigation = await screen.findByRole("navigation", { name: "Primary navigation" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Chats", "Scouts"]);
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

  test("sends a prompt through the chosen model on the selected chat", async () => {
    const user = userEvent.setup();
    await openChats();
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Driver" }),
      "openai/gpt-5.6-luna",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Message Scout" }),
      "Inspect the submit button",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      model: "openai/gpt-5.6-luna",
      prompt: "Inspect the submit button",
    });
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
    expect(remote.executeTool).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      toolName: "browser_execute",
      input: JSON.stringify(input),
      operationId: expect.any(String),
    });
  });

  test.each([
    { toolName: "web_search", input: { query: "form builder pricing" } },
    { toolName: "web_read", input: { url: "https://example.com" } },
    {
      toolName: "send_message",
      input: { to: "person@gmail.com", subject: "Hello", text: "A note from Scout." },
    },
    {
      toolName: "reply_to_message",
      input: { messageId: "message-1", text: "Thanks for the update." },
    },
    {
      toolName: "record_authenticated_service_account",
      input: {
        accountAccess: "recovered",
        loginMethod: "managed_password",
        identityText: "scout-1@example.com",
        sessionControlText: "Sign out",
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
    expect(remote.executeTool).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      toolName,
      input: JSON.stringify(input),
      operationId: expect.any(String),
    });
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
    expect(toolDescription?.textContent).toContain(BROWSER_STATE_HELPER_SOURCE);
    const resize = screen.getByRole("separator", { name: "Resize agent context" });
    expect(resize.getAttribute("aria-valuenow")).toBe("288");
    fireEvent.keyDown(resize, { key: "ArrowUp" });
    expect(resize.getAttribute("aria-valuenow")).toBe("336");
    for (let step = 0; step < 8; step += 1) fireEvent.keyDown(resize, { key: "ArrowDown" });
    expect(resize.getAttribute("aria-valuenow")).toBe("144");
  });

  test("shows the live browser beside the conversation and keeps the handoff accessible", async () => {
    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    remote.queries.set("humanHandoffs:active", {
      handoffId: "handoff-1",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      expiresAt: Date.now() + 60_000,
      phase: "unclaimed",
    });
    const user = userEvent.setup();
    const router = await openChats();
    const handoff = await screen.findByRole("link", { name: "Open browser handoff" });
    expect(handoff.getAttribute("href")).toBe("/handoff/handoff-1");
    const frame = await screen.findByTitle("Live browser session 1");
    expect(frame.getAttribute("src")).toBe("about:blank#scout-live");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    const conversation = screen.getByRole("region", { name: "Conversation" });
    const pane = conversation.closest('[data-pane-side="right"]');
    expect(pane).not.toBeNull();
    expect(pane?.hasAttribute("data-desktop-open")).toBe(true);
    const composer = within(conversation).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message Scout",
    });
    await user.type(composer, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Hide conversation" }));
    expect(pane?.hasAttribute("data-desktop-open")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Show conversation" }));
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
    remote.queries.set("humanHandoffs:active", {
      handoffId: "handoff-1",
      reason: "Complete the CAPTCHA.",
      requestedAt: 1,
      failedAt: 2,
      phase: "delivery_failed",
    });

    await openChats();

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("could not deliver the private handoff link");
    expect(notice.textContent).toContain("ask Scout to try");
    expect(screen.queryByRole("link", { name: "Open browser handoff" })).toBeNull();
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

  test("keeps the selected recording when another session appears and supports history navigation", async () => {
    const closed = { ...session("session-1", 1), lifecycle: { kind: "closed", closedAt: 2 } };
    remote.queries.set("scout/browserSessions:list", [closed]);
    remote.queries.set("scout/browserSessions:get:session-1", { ...closed, operations: [] });
    const user = userEvent.setup();
    const router = await openChats();
    await screen.findByText("No replay");
    await waitFor(() => expect(router.state.location.search.session).toBe("session-1"));
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
    expect(picker.value).toBe("session-1");
    expect(screen.queryByTitle("Live browser session 2")).toBeNull();
    await user.selectOptions(picker, "session-2");
    expect(await screen.findByTitle("Live browser session 2")).toBeTruthy();
    expect(router.state.location.search.session).toBe("session-2");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "Continue later",
    );

    act(() => router.history.back());
    expect(await screen.findByText("No replay")).toBeTruthy();
    expect(router.state.location.search.session).toBe("session-1");
  });

  test("moves the conversation beside the first browser without losing the draft or driver", async () => {
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
      screen.getByRole("region", { name: "Conversation" }).closest('[data-pane-side="right"]'),
    ).not.toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).value).toBe(
      "Still typing",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Driver" }).value).toBe(
      "openai/gpt-5.6-luna",
    );
  });

  test("keeps chat selected on a small screen when the browser appears and allows switching panes", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const user = userEvent.setup();
    await openChats();
    await screen.findByRole("textbox", { name: "Message Scout" });

    const browser = session("session-1", 1);
    remote.queries.set("scout/browserSessions:list", [browser]);
    remote.queries.set("scout/browserSessions:get", { ...browser, operations: [] });
    remote.queries.set("scout/browserSessions:liveView", { url: "about:blank#scout-live" });
    refreshQueries();

    const showBrowser = await screen.findByRole("button", { name: "Show browser" });
    expect(showBrowser.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("button", { name: "Hide conversation" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(showBrowser);
    expect(showBrowser.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Show conversation" }));
    expect(showBrowser.getAttribute("aria-pressed")).toBe("false");
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

  test("stores only the selected chat and browser session in the URL", () => {
    const validateSearch = ChatsRoute.options.validateSearch;
    if (typeof validateSearch !== "function") throw new Error("Chat search validator is missing");
    expect(
      validateSearch({
        thread: "thread-1",
        session: "session-1",
        view: "live",
        experiment: "discarded",
      }),
    ).toEqual({ thread: "thread-1", session: "session-1" });
    expect(validateSearch({ thread: 7, session: {}, view: "product" })).toEqual({});
  });
});
