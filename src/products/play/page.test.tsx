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
  remote.revision = 0;
  remote.queries.clear();
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
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/play/session",
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

  test("stops its own active game but cannot stop another session", async () => {
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
      remote.queries.set("scout/chats:getScoutActivity", {
        kind: "running",
        threadId: "another-game",
        turnId: "turn-2",
      });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(screen.getByText("Playing in another session")).toBeTruthy();
  });
});
