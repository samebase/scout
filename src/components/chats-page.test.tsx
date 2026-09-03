// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { type ReactNode } from "react";
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
  remote.executeTool.mockResolvedValue(null);
  remote.listReplayPages.mockResolvedValue({ status: "unavailable" });
  remote.mutations.set("scout/chats:createThread", remote.createThread);
  remote.mutations.set("scout/chats:sendMessage", remote.sendMessage);
  remote.actions.set("scout/manual:executeTool", remote.executeTool);
  remote.actions.set("browserReplay:listPages", remote.listReplayPages);
});

afterEach(() => cleanup());

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
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();
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
      input,
    });
  });

  test.each([
    { toolName: "web_search", input: { query: "form builder pricing" } },
    { toolName: "web_read", input: { url: "https://example.com" } },
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
      input,
    });
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

  test("opens the current live browser and exposes an active handoff in the transcript", async () => {
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
    await user.click(screen.getByRole("button", { name: "Live" }));

    const frame = await screen.findByTitle("Live browser session 1");
    expect(frame.getAttribute("src")).toBe("about:blank#scout-live");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    expect(router.state.location.search).toEqual({ thread: "thread-1", view: "live" });
  });

  test("loads the requested closed browser session for replay", async () => {
    const closed = { ...session("session-closed", 1), lifecycle: { kind: "closed", closedAt: 2 } };
    const active = session("session-active", 2);
    remote.queries.set("scout/browserSessions:list", [closed, active]);
    remote.queries.set("scout/browserSessions:get:session-closed", { ...closed, operations: [] });
    remote.queries.set("scout/browserSessions:get:session-active", { ...active, operations: [] });
    const router = await openChats("/chats?thread=thread-1&view=replay&session=session-closed");

    expect(await screen.findByText("No replay")).toBeTruthy();
    expect(remote.listReplayPages).toHaveBeenCalledExactlyOnceWith({ sessionId: "session-closed" });
    expect(router.state.location.search).toEqual({
      thread: "thread-1",
      view: "replay",
      session: "session-closed",
    });
  });

  test("does not let an unavailable chat receive a message", async () => {
    await openChats("/chats?thread=missing");
    expect(await screen.findByText("Chat not available")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message Scout" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("accepts only chat selection, view, and browser-session search parameters", () => {
    const validateSearch = ChatsRoute.options.validateSearch;
    if (typeof validateSearch !== "function") throw new Error("Chat search validator is missing");
    expect(
      validateSearch({
        thread: "thread-1",
        session: "session-1",
        view: "live",
        experiment: "discarded",
      }),
    ).toEqual({ thread: "thread-1", session: "session-1", view: "live" });
    expect(validateSearch({ thread: 7, session: {}, view: "product" })).toEqual({});
  });
});
