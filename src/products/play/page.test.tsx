// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReturnType, type FunctionReference } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Route as PlayRoute } from "../../routes/play.session";
import { api } from "../../../convex/_generated/api";
import { ROLE_ACCESS_GRANTS } from "../../../shared/accessModel";
import { omitNullish } from "../../../shared/omitNullish";

const remote = vi.hoisted(() => ({
  authenticated: true,
  messages: Array<FunctionReturnType<typeof api.scout.chats.listMessages>["page"][number]>(),
  revision: 0,
  subscribers: new Set<() => void>(),
  queries: new Map<string, unknown>(),
  createThread: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  signIn: vi.fn(),
  queryCalls: vi.fn(),
}));

function subscribe(listener: () => void) {
  remote.subscribers.add(listener);
  return () => remote.subscribers.delete(listener);
}

vi.mock("convex/react", () => ({
  useConvexAuth: () => {
    useSyncExternalStore(subscribe, () => remote.revision);
    return { isAuthenticated: remote.authenticated, isLoading: false };
  },
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    remote.queryCalls(getFunctionName(reference), args);
    return args === "skip" ? undefined : remote.queries.get(getFunctionName(reference));
  },
  usePaginatedQuery: (reference: FunctionReference<"query">) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    return remote.queries.get(getFunctionName(reference));
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    switch (getFunctionName(reference)) {
      case "scout/chats:createThread":
        return remote.createThread;
      case "scout/chats:sendMessage":
        return remote.sendMessage;
      case "scout/chats:stop":
        return remote.stop;
      default:
        throw new Error("Unexpected mutation");
    }
  },
}));

vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: () => {
    useSyncExternalStore(subscribe, () => remote.revision);
    return { results: remote.messages, status: "Exhausted" };
  },
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: remote.signIn }),
}));

beforeEach(() => {
  remote.messages = [];
  remote.authenticated = true;
  remote.queryCalls.mockClear();
  remote.revision = 0;
  remote.queries.clear();
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    userId: "admin",
    role: "role_staff",
    isApproved: false,
    accessKeys: ROLE_ACCESS_GRANTS.role_staff,
  });
  remote.queries.set("scout/scouts:list", [
    { _id: "scout-1", displayName: "Pip", status: "active" },
    { _id: "scout-2", displayName: "Moss", status: "active" },
  ]);
  remote.queries.set("scout/chats:listThreads", {
    results: [{ threadId: "game-thread", scoutId: "scout-1", title: null, play: { step: null } }],
    status: "Exhausted",
  });
  remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
  remote.queries.set("scout/browserSessions:list", []);
  remote.createThread.mockReset().mockResolvedValue({ threadId: "game-thread" });
  remote.sendMessage.mockReset().mockResolvedValue(null);
  remote.stop.mockReset().mockResolvedValue(null);
  remote.signIn.mockReset();
  // happy-dom does not implement the browser's scrolling API.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

async function openPlay(path = "/play/session") {
  const root = createRootRoute({ staticData: { access: "access_public" } });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/play/session",
    staticData: { access: "access_public" },
    ...omitNullish({
      component: PlayRoute.options.component,
      validateSearch: PlayRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

const invitation = "Play with me at https://example.com/room/blue. Wait for me to start.";
function fillInvite() {
  fireEvent.change(screen.getByLabelText("Message Scout"), { target: { value: invitation } });
}

describe("Play invitation", () => {
  test.each(["/play/session", "/play/session?thread=game-thread"])(
    "members never mount Lab data queries at %s",
    async (path) => {
      remote.queries.set("accounts:currentViewerAccess", {
        kind: "account",
        userId: "member",
        role: "role_member",
        isApproved: true,
        accessKeys: ROLE_ACCESS_GRANTS.role_member,
      });
      await openPlay(path);
      expect(await screen.findByRole("heading", { name: "Play access is coming" })).toBeTruthy();
      expect(
        remote.queryCalls.mock.calls.filter(
          ([name, args]) => name.startsWith("scout/") && args !== "skip",
        ),
      ).toEqual([]);
      expect(remote.createThread).not.toHaveBeenCalled();
    },
  );

  test.each(["/play/session", "/play/session?thread=game-thread"])(
    "pending accounts wait for approval without loading Lab data at %s",
    async (path) => {
      remote.queries.set("accounts:currentViewerAccess", {
        kind: "account",
        userId: "member",
        role: "role_pending_access",
        isApproved: false,
        accessKeys: ROLE_ACCESS_GRANTS.role_pending_access,
      });
      await openPlay(path);
      expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
      expect(
        remote.queryCalls.mock.calls.filter(
          ([name, args]) => name.startsWith("scout/") && args !== "skip",
        ),
      ).toEqual([]);
      expect(remote.createThread).not.toHaveBeenCalled();
      act(() => {
        remote.queries.set("accounts:currentViewerAccess", {
          kind: "account",
          userId: "member",
          role: "role_member",
          isApproved: true,
          accessKeys: ROLE_ACCESS_GRANTS.role_member,
        });
        remote.revision += 1;
        for (const notify of remote.subscribers) notify();
      });
      expect(await screen.findByRole("heading", { name: "Play access is coming" })).toBeTruthy();
      expect(
        remote.queryCalls.mock.calls.filter(
          ([name, args]) => name.startsWith("scout/") && args !== "skip",
        ),
      ).toEqual([]);
    },
  );

  test("access loss unmounts an open session without another sign-in", async () => {
    await openPlay("/play/session?thread=game-thread");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    act(() => {
      remote.queries.set("accounts:currentViewerAccess", {
        kind: "account",
        userId: "admin",
        role: "role_member",
        isApproved: true,
        accessKeys: ROLE_ACCESS_GRANTS.role_member,
      });
      remote.revision += 1;
      for (const notify of remote.subscribers) notify();
    });
    expect(await screen.findByRole("heading", { name: "Play access is coming" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation with Scout" })).toBeNull();
  });

  test("opening an existing session does not start or stop Scout", async () => {
    await openPlay("/play/session?thread=game-thread");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(remote.stop).not.toHaveBeenCalled();
  });

  test("an unavailable session does not create a replacement chat", async () => {
    await openPlay("/play/session?thread=missing-thread");
    expect(await screen.findByRole("heading", { name: "Session not found" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(remote.stop).not.toHaveBeenCalled();
  });

  test("keeps the invitation through sign-in without starting a game automatically", async () => {
    remote.authenticated = false;
    await openPlay();
    fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    act(() => {
      remote.authenticated = true;
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.getByDisplayValue(invitation)).toBeTruthy();
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("sends a game request with the selected Scout and opens its session", async () => {
    const router = await openPlay();
    fillInvite();
    fireEvent.change(screen.getByLabelText("Your player"), { target: { value: "scout-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ thread: "game-thread" }));
    expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({
      scoutId: "scout-2",
      purpose: "play",
    });
    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "game-thread",
      prompt: invitation,
    });
    expect(remote.sendMessage.mock.calls[0]?.[0].prompt).toContain("Wait for me to start.");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  });

  test("reuses the chat when an invitation must be retried", async () => {
    remote.sendMessage.mockRejectedValueOnce(new Error("Scout is busy"));
    await openPlay();
    fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByDisplayValue(invitation)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(remote.sendMessage).toHaveBeenCalledTimes(2));
    expect(remote.createThread).toHaveBeenCalledTimes(1);
  });

  test("points to setup when every Scout is disabled", async () => {
    remote.queries.set("scout/scouts:list", [
      { _id: "scout-1", displayName: "Pip", status: "disabled" },
    ]);
    await openPlay();
    expect(screen.getByRole("link", { name: "Set up a Scout" }).getAttribute("href")).toBe(
      "/scouts",
    );
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test("accepts a research request without a game link", async () => {
    await openPlay();
    fireEvent.change(screen.getByLabelText("Message Scout"), {
      target: { value: "Find us a cooperative game for tomorrow." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
        threadId: "game-thread",
        prompt: "Find us a cooperative game for tomorrow.",
      }),
    );
  });

  test("does not submit an empty message", async () => {
    await openPlay();
    fireEvent.change(screen.getByLabelText("Message Scout"), { target: { value: "   " } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      true,
    );
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test("stops its own active game but disables controls while Scout is busy elsewhere", async () => {
    remote.queries.set("scout/chats:getScoutActivity", {
      kind: "running",
      threadId: "game-thread",
      turnId: "turn-1",
    });
    await openPlay("/play/session?thread=game-thread");
    fireEvent.click(await screen.findByRole("button", { name: "Stop Scout" }));
    await waitFor(() =>
      expect(remote.stop).toHaveBeenCalledExactlyOnceWith({ threadId: "game-thread" }),
    );
    act(() => {
      remote.queries.set("scout/chats:getScoutActivity", { kind: "busy" });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(screen.getByText("Busy in another session")).toBeTruthy();
    expect(screen.getByText("Scout is busy in another session.")).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      true,
    );
    expect(document.body.textContent).not.toContain("another-game");
  });
});

test("shows persisted activity and assistant commentary while hiding tool payloads", async () => {
  remote.queries.set("scout/chats:listThreads", {
    results: [
      {
        threadId: "game-thread",
        scoutId: "scout-1",
        title: "Learn a new game",
        play: { step: "research" },
      },
    ],
    status: "Exhausted",
  });
  remote.queries.set("scout/chats:getScoutActivity", {
    kind: "running",
    threadId: "game-thread",
    turnId: "turn-1",
  });
  remote.messages = [
    {
      id: "user-1",
      _creationTime: 1,
      key: "user-1",
      order: 0,
      stepOrder: 0,
      status: "success",
      role: "user",
      text: "Help me learn this game.",
      parts: [{ type: "text", text: "Help me learn this game." }],
    },
    {
      id: "assistant-1",
      _creationTime: 2,
      key: "assistant-1",
      order: 0,
      stepOrder: 1,
      status: "success",
      role: "assistant",
      text: "I'll check the rules before we start.",
      parts: [{ type: "text", text: "I'll check the rules before we start." }],
    },
    {
      id: "tool-1",
      _creationTime: 3,
      key: "tool-1",
      order: 0,
      stepOrder: 2,
      status: "success",
      role: "assistant",
      text: "",
      parts: [
        { type: "tool-browser_execute", input: { code: "secret_browser_code()" } },
        { type: "reasoning", text: "private reasoning" },
      ],
    },
  ];
  await openPlay("/play/session?thread=game-thread");
  expect(await screen.findByLabelText("Current activity")).toHaveProperty(
    "textContent",
    "Researching the game",
  );
  expect(screen.getByText("I'll check the rules before we start.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret_browser_code");
  expect(document.body.textContent).not.toContain("private reasoning");
  fireEvent.change(screen.getByLabelText("Message Scout"), {
    target: { value: "I'll be back in a minute." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Scout’s view" }));
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  expect(screen.getByDisplayValue("I'll be back in a minute.")).toBeTruthy();
  expect(remote.sendMessage).not.toHaveBeenCalled();
});

test("Enter sends a message but composition and Shift+Enter do not", async () => {
  await openPlay("/play/session?thread=game-thread");
  const input = screen.getByLabelText("Message Scout");
  fireEvent.change(input, { target: { value: "Your turn." } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(remote.sendMessage).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "game-thread",
      prompt: "Your turn.",
    }),
  );
});

test("keeps the live browser and handoff controls when switching views", async () => {
  remote.queries.set("scout/browserSessions:list", [
    { sessionId: "session-1", lifecycle: { kind: "active" } },
  ]);
  remote.queries.set("scout/browserSessions:liveView", {
    url: "about:blank",
  });
  remote.queries.set("scout/chats:getScoutActivity", {
    kind: "handoff",
    threadId: "game-thread",
    turnId: "turn-1",
  });
  remote.queries.set("humanHandoffs:forSession", {
    handoffId: "handoff-1",
    status: "available",
    reason: "Please complete the verification.",
    requestedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  await openPlay("/play/session?thread=game-thread");
  const browser = await screen.findByTitle("Scout's live game browser");
  fireEvent.click(screen.getByRole("button", { name: "Scout’s view" }));
  expect(screen.getByTitle("Scout's live game browser")).toBe(browser);
  expect(screen.getByRole("link", { name: "Open browser handoff" }).getAttribute("href")).toBe(
    "/handoff/handoff-1",
  );
  expect(screen.getByRole("button", { name: "Stop Scout" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  expect(screen.getByTitle("Scout's live game browser")).toBe(browser);
  fireEvent.click(screen.getByRole("button", { name: "Cancel handoff" }));
  await waitFor(() =>
    expect(remote.stop).toHaveBeenCalledExactlyOnceWith({ threadId: "game-thread" }),
  );
});
