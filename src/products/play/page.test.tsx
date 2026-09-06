// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Route as PlayRoute } from "../../routes/play.session";
import { ROLE_ACCESS_GRANTS } from "../../../shared/accessModel";
import { omitNullish } from "../../../shared/omitNullish";

const remote = vi.hoisted(() => ({
  authenticated: true,
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
  useUIMessages: () => ({ results: [], status: "Exhausted" }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: remote.signIn }),
}));

beforeEach(() => {
  remote.authenticated = true;
  remote.queryCalls.mockClear();
  remote.revision = 0;
  remote.queries.clear();
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    userId: "admin",
    role: "role_admin",
    status: "active",
    isApproved: true,
    accessKeys: ROLE_ACCESS_GRANTS.role_admin,
  });
  remote.queries.set("scout/scouts:list", [
    { _id: "scout-1", displayName: "Pip", status: "active" },
    { _id: "scout-2", displayName: "Moss", status: "active" },
  ]);
  remote.queries.set("scout/chats:listThreads", {
    results: [{ threadId: "game-thread", scoutId: "scout-1", title: null }],
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

function fillInvite() {
  fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
  fireEvent.change(screen.getByLabelText("Your game link"), {
    target: { value: "https://example.com/room/blue" },
  });
  fireEvent.change(screen.getByLabelText(/Anything Scout should know/), {
    target: { value: "Wait for me to start." },
  });
}

describe("Play invitation", () => {
  test.each(["/play/session", "/play/session?thread=game-thread"])(
    "members never mount Lab data queries at %s",
    async (path) => {
      remote.queries.set("accounts:currentViewerAccess", {
        kind: "account",
        userId: "member",
        role: "role_member",
        status: "active",
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
        role: "role_member",
        status: "active",
        isApproved: false,
        accessKeys: ["access_public", "access_account"],
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
          status: "active",
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
        status: "active",
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
    fireEvent.click(screen.getByRole("button", { name: "Invite Scout" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    act(() => {
      remote.authenticated = true;
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.getByDisplayValue("https://example.com/room/blue")).toBeTruthy();
    expect(screen.getByDisplayValue("Wait for me to start.")).toBeTruthy();
    expect(remote.sendMessage).not.toHaveBeenCalled();
  });

  test("sends a game request with the selected Scout and opens its session", async () => {
    const router = await openPlay();
    fillInvite();
    fireEvent.change(screen.getByLabelText("Your player"), { target: { value: "scout-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite Scout" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ thread: "game-thread" }));
    expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({ scoutId: "scout-2" });
    expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
      threadId: "game-thread",
      prompt: expect.stringContaining("https://example.com/room/blue"),
    });
    expect(remote.sendMessage.mock.calls[0]?.[0].prompt).toContain("Wait for me to start.");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  });

  test("reuses the chat when an invitation must be retried", async () => {
    remote.sendMessage.mockRejectedValueOnce(new Error("Scout is busy"));
    await openPlay();
    fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "Invite Scout" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByDisplayValue("https://example.com/room/blue")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invite Scout" }));
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
    expect(screen.getByRole("button", { name: "Invite Scout" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test("rejects non-web links before any mutation", async () => {
    await openPlay();
    fireEvent.change(screen.getByLabelText("Your game link"), {
      target: { value: "ftp://example.com/room" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite Scout" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
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
    expect(screen.getByText("Playing in another session")).toBeTruthy();
    expect(screen.getByText("Scout is busy in another session.")).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      true,
    );
    expect(document.body.textContent).not.toContain("another-game");
  });
});
