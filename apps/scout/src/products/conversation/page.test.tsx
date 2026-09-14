// @vitest-environment happy-dom

import userEvent from "@testing-library/user-event";
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
import { Route as ReviewRoute } from "../../routes/review";
import { Route as PlayRoute } from "../../routes/play";
import { api } from "../../../convex/_generated/api";
import { ROLE_ACCESS_GRANTS } from "../../../shared/accessModel";
import { omitNullish } from "../../../shared/omitNullish";

const remote = vi.hoisted(() => ({
  authenticated: true,
  messages: Array<FunctionReturnType<typeof api.scout.activity.messages>["page"][number]>(),
  revision: 0,
  subscribers: new Set<() => void>(),
  queries: new Map<string, unknown>(),
  createThread: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  sendManaged: vi.fn(),
  stopManaged: vi.fn(),
  resumeManaged: vi.fn(),
  setVisibility: vi.fn(),
  setReviewSite: vi.fn(),
  signIn: vi.fn(),
  queryCalls: vi.fn(),
  listReplayPages: vi.fn(),
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
    if (args === "skip") return undefined;
    if (
      getFunctionName(reference) === "scout/activity:get" &&
      args &&
      typeof args === "object" &&
      "threadId" in args &&
      args.threadId === "missing-thread"
    )
      return null;
    if (args && typeof args === "object" && "sessionId" in args) {
      const scopedKey = `${getFunctionName(reference)}:${String(args.sessionId)}`;
      if (remote.queries.has(scopedKey)) return remote.queries.get(scopedKey);
    }
    return remote.queries.get(getFunctionName(reference));
  },
  useAction: (reference: FunctionReference<"action">) => {
    if (getFunctionName(reference) === "browserReplay:listPages") return remote.listReplayPages;
    throw new Error("Unexpected action");
  },
  usePaginatedQuery: (reference: FunctionReference<"query">) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    if (getFunctionName(reference) === "scout/activity:messages")
      return { results: remote.messages, status: "Exhausted" };
    return remote.queries.get(getFunctionName(reference));
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    switch (getFunctionName(reference)) {
      case "scout/chats:startProductChat":
        return remote.createThread;
      case "scout/chats:sendMessage":
        return remote.sendMessage;
      case "scout/chats:stop":
        return remote.stop;
      case "scout/reviewSites:set":
        return remote.setReviewSite;
      case "scout/chats:setVisibility":
        return remote.setVisibility;
      case "agentsApi/sessions:send":
        return remote.sendManaged;
      case "agentsApi/sessions:stop":
        return remote.stopManaged;
      case "agentsApi/sessions:resume":
        return remote.resumeManaged;
      default:
        throw new Error("Unexpected mutation");
    }
  },
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: remote.signIn }),
}));

function session(overrides = {}) {
  return {
    threadId: "game-thread",
    title: null,
    primarySite: null,
    createdAt: 1000,
    purpose: { kind: "play", step: null },
    visibility: "private",
    status: "ready",
    scout: { _id: "scout-1", displayName: "Pip", status: "active" },
    isOwner: true,
    canControl: true,
    sessions: [],
    runtime: { kind: "convex_agent" },
    latestSession: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
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
  remote.queries.set("scout/activity:players", [
    { _id: "scout-1", displayName: "Pip", status: "active" },
    { _id: "scout-2", displayName: "Moss", status: "active" },
  ]);
  remote.queries.set("scout/activity:get", session());
  remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
  remote.createThread.mockReset().mockResolvedValue({ threadId: "game-thread" });
  remote.sendMessage.mockReset().mockResolvedValue(null);
  remote.stop.mockReset().mockResolvedValue(null);
  remote.sendManaged.mockReset().mockResolvedValue(null);
  remote.stopManaged.mockReset().mockResolvedValue(null);
  remote.resumeManaged.mockReset().mockResolvedValue(null);
  remote.setReviewSite.mockReset().mockResolvedValue(null);
  remote.setVisibility.mockReset().mockResolvedValue(null);
  remote.signIn.mockReset();
  remote.listReplayPages.mockReset().mockResolvedValue({ status: "unavailable" });
  // happy-dom does not implement the browser's scrolling API.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openPlay(path = "/play") {
  const root = createRootRoute({ staticData: { access: "access_public" } });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/play",
    staticData: { access: "access_public" },
    ...omitNullish({
      component: PlayRoute.options.component,
      validateSearch: PlayRoute.options.validateSearch,
    }),
  });
  const review = createRoute({
    getParentRoute: () => root,
    path: "/review",
    staticData: { access: "access_public" },
    ...omitNullish({
      component: ReviewRoute.options.component,
      validateSearch: ReviewRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([route, review]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("admins can open another member's Review in the Agents inspector", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      isOwner: false,
      canControl: false,
      visibility: "public",
    }),
  );
  await openPlay("/review?thread=game-thread");
  expect((await screen.findByRole("link", { name: "Open in lab" })).getAttribute("href")).toBe(
    "/agents?session=managed-1",
  );
  expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/sessions:controls", "skip");
});

test("Review uses managed controls and keeps live view, handoff and follow-up messages on the same page", async () => {
  const review = session({
    purpose: { kind: "review" },
    runtime: { kind: "agents_api", sessionId: "managed-1" },
    status: "waiting",
    sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "active", createdAt: 1000 }],
  });
  remote.queries.set("scout/activity:get", review);
  remote.queries.set("scout/activity:liveView", { url: "about:blank#watch-only" });
  remote.queries.set("agentsApi/sessions:controls", {
    state: {
      kind: "waiting",
      message: "Complete verification",
      callId: "call-current",
      turnId: "turn-current",
    },
    canSend: false,
    canStop: true,
    busy: false,
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
    handoffEmailFailed: false,
  });
  remote.messages = [{ id: "message-1", role: "assistant", text: "I opened the site." }];
  await openPlay("/review?thread=game-thread");
  expect(await screen.findByText("I opened the site.")).toBeTruthy();
  expect(screen.getByTitle("Scout's live browser").getAttribute("src")).toBe(
    "about:blank#watch-only",
  );
  expect(screen.getByRole("link", { name: "Open in lab" }).getAttribute("href")).toBe(
    "/agents?session=managed-1",
  );
  fireEvent.click(screen.getByRole("button", { name: "Resume Scout" }));
  await waitFor(() =>
    expect(remote.resumeManaged).toHaveBeenCalledExactlyOnceWith({
      sessionId: "managed-1",
      callId: "call-current",
      turnId: "turn-current",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole<HTMLButtonElement>("button", { name: "Stop Scout" })[0]?.disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Stop Scout" })[0]);
  await waitFor(() =>
    expect(remote.stopManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
  );
  act(() => {
    remote.queries.set("scout/activity:get", { ...review, status: "finished" });
    remote.queries.set("agentsApi/sessions:controls", {
      state: { kind: "idle" },
      canSend: true,
      canStop: false,
      busy: false,
      interactiveLiveViewUrl: null,
      handoffEmailFailed: false,
    });
    remote.revision++;
    remote.subscribers.forEach((listener) => listener());
  });
  fireEvent.change(screen.getByLabelText("Message Scout"), {
    target: { value: "Check another page" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
      sessionId: "managed-1",
      message: "Check another page",
    }),
  );
  expect(remote.stop).not.toHaveBeenCalled();
  expect(remote.sendMessage).not.toHaveBeenCalled();
  expect(remote.queryCalls).toHaveBeenCalledWith("scout/chats:getScoutActivity", "skip");
  expect(remote.queryCalls).toHaveBeenCalledWith("humanHandoffs:forSession", "skip");
});

test("public managed Reviews do not request owner controls or expose the handoff", async () => {
  remote.authenticated = false;
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      visibility: "public",
      isOwner: false,
      canControl: false,
      status: "waiting",
    }),
  );
  await openPlay("/review?thread=game-thread");
  expect(screen.queryByLabelText("Message Scout")).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
  expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/sessions:controls", "skip");
});

test.each(["Finish signing in before resuming.", "Could not capture browser evidence."])(
  "keeps a blocked resume reason visible while waiting and disables resume and send during checking: %s",
  async (reason) => {
    const review = session({
      purpose: { kind: "review" },
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      status: "waiting",
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "active", createdAt: 1000 }],
    });
    const controls = {
      state: {
        kind: "waiting",
        message: "Complete verification",
        callId: "call-latest",
        turnId: "turn-latest",
      },
      canSend: false,
      canStop: true,
      busy: false,
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
      handoffEmailFailed: false,
      requestCheckMessage: reason,
    };
    remote.queries.set("scout/activity:get", review);
    remote.queries.set("agentsApi/sessions:controls", controls);
    remote.queries.set("scout/activity:liveView", { url: "about:blank#watch-only" });
    remote.messages = [{ id: "message-1", role: "assistant", text: "I opened the site." }];
    await openPlay("/review?thread=game-thread");
    expect((await screen.findByRole("alert")).textContent).toBe(reason);
    const draft = screen.getByLabelText<HTMLTextAreaElement>("Message Scout");
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Resume Scout" }));
    await waitFor(() =>
      expect(remote.resumeManaged).toHaveBeenCalledExactlyOnceWith({
        sessionId: "managed-1",
        callId: "call-latest",
        turnId: "turn-latest",
      }),
    );
    act(() => {
      remote.queries.set("agentsApi/sessions:controls", {
        ...controls,
        state: { kind: "checking", checkId: "resume-check-2" },
        requestCheckMessage: null,
      });
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(await screen.findByText("Checking…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
    expect(screen.queryByText(reason)).toBeNull();
    expect(screen.queryByText("Complete verification")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    const form = draft.closest("form");
    if (!form) throw new Error("The message draft has no form");
    fireEvent.submit(form);
    expect(remote.sendManaged).not.toHaveBeenCalled();
    expect(draft.value).toBe("Keep this draft");
    expect(screen.getByText("I opened the site.")).toBeTruthy();
    expect(screen.getByTitle("Scout's live browser").getAttribute("src")).toBe(
      "about:blank#watch-only",
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop Scout" })[0]).toHaveProperty(
        "disabled",
        false,
      ),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Stop Scout" })[0]);
    await waitFor(() =>
      expect(remote.stopManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
    );
    expect(remote.resumeManaged).toHaveBeenCalledTimes(1);
  },
);

const invitation = "Play with me at https://example.com/room/blue. Wait for me to start.";
function fillInvite() {
  fireEvent.change(screen.getByLabelText("Message Scout"), { target: { value: invitation } });
}

describe("Play invitation", () => {
  test("a Review owner can correct its site and sees save errors", async () => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, primarySite: "samebase.com" }),
    );
    await openPlay("/review?thread=game-thread");
    const user = userEvent.setup();
    expect((await screen.findByRole("link", { name: "samebase.com" })).getAttribute("href")).toBe(
      "/?site=samebase.com&scope=mine",
    );
    await user.click(screen.getByRole("button", { name: "Edit review site" }));
    const field = screen.getByRole("textbox", { name: "Review site" });
    await user.clear(field);
    await user.type(field, "www.samebase.com");
    remote.setReviewSite.mockRejectedValueOnce(new Error("Offline"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn't save the site. Try again.",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Review site" })).toBeNull());
    expect(remote.setReviewSite).toHaveBeenLastCalledWith({
      threadId: "game-thread",
      site: "www.samebase.com",
    });
  });

  test("a public Review viewer can follow its site but cannot edit it", async () => {
    remote.queries.set(
      "scout/activity:get",
      session({
        purpose: { kind: "review" },
        primarySite: "samebase.com",
        visibility: "public",
        isOwner: false,
        canControl: false,
      }),
    );
    await openPlay("/review?thread=game-thread");
    expect((await screen.findByRole("link", { name: "samebase.com" })).getAttribute("href")).toBe(
      "/?site=samebase.com&scope=public",
    );
    expect(screen.queryByRole("button", { name: "Edit review site" })).toBeNull();
  });

  test("Review starts on its own route using the shared chat interface", async () => {
    remote.queries.set("scout/activity:get", session({ purpose: { kind: "review" } }));
    const router = await openPlay("/review");
    expect(await screen.findByRole("heading", { name: "Send a Scout instead." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Find a game for us" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Message Scout"), {
      target: { value: "Review example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.createThread).toHaveBeenCalledWith({
        kind: "review",
        scoutId: "scout-1",
        prompt: "Review example.com",
        visibility: "public",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/review"));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ thread: "game-thread" }),
    );
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  });

  test("a Play conversation cannot silently open in Review mode", async () => {
    await openPlay("/review?thread=game-thread");
    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeTruthy();
    expect(screen.queryByLabelText("Message Scout")).toBeNull();
  });

  test("approved members can start games without mounting Lab queries", async () => {
    remote.queries.set("accounts:currentViewerAccess", {
      kind: "account",
      userId: "member",
      role: "role_member",
      isApproved: true,
      accessKeys: ROLE_ACCESS_GRANTS.role_member,
    });
    await openPlay();
    fillInvite();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Visibility" }));
    await user.click(screen.getByRole("option", { name: "Public" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.createThread).toHaveBeenCalledWith({
        kind: "play",
        scoutId: "scout-1",
        prompt: invitation,
        visibility: "public",
      }),
    );
    expect(
      remote.queryCalls.mock.calls.some(
        ([name, args]) =>
          args !== "skip" &&
          ["scout/chats:listThreads", "scout/scouts:list", "scout/chats:listMessages"].includes(
            name,
          ),
      ),
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Open in lab" })).toBeNull();
  });

  test("pending accounts cannot start games", async () => {
    remote.queries.set("accounts:currentViewerAccess", {
      kind: "account",
      userId: "member",
      role: "role_pending_access",
      isApproved: false,
      accessKeys: ROLE_ACCESS_GRANTS.role_pending_access,
    });
    await openPlay();
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
  });

  test("guests can watch public sessions without owner controls or a sign-in gate", async () => {
    remote.authenticated = false;
    remote.queries.set(
      "scout/activity:get",
      session({ visibility: "public", isOwner: false, canControl: false }),
    );
    await openPlay("/play?thread=game-thread");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in lab" })).toBeNull();
    expect(screen.getByRole("link", { name: "Play with Scout" })).toBeTruthy();
    expect(
      remote.queryCalls.mock.calls.filter(
        ([name, args]) =>
          args !== "skip" &&
          ["humanHandoffs:forSession", "scout/chats:getScoutActivity"].includes(name),
      ),
    ).toEqual([]);
  });

  test("a revoked viewing permission unmounts the session", async () => {
    await openPlay("/play?thread=game-thread");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    act(() => {
      remote.queries.set("scout/activity:get", null);
      remote.revision += 1;
      remote.subscribers.forEach((notify) => notify());
    });
    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation with Scout" })).toBeNull();
  });

  test("opening an existing session does not start or stop Scout", async () => {
    await openPlay("/play?thread=game-thread");
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(remote.stop).not.toHaveBeenCalled();
  });

  test("an unavailable session does not create a replacement chat", async () => {
    await openPlay("/play?thread=missing-thread");
    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeTruthy();
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
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Your Scout" }));
    await user.click(screen.getByRole("option", { name: "Moss" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ thread: "game-thread" }));
    expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({
      kind: "play",
      scoutId: "scout-2",
      visibility: "private",
      prompt: invitation,
    });
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  });

  test("retains the prompt when starting a game fails", async () => {
    remote.createThread.mockRejectedValueOnce(new Error("Scout is busy"));
    await openPlay();
    fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByDisplayValue(invitation)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(remote.createThread).toHaveBeenCalledTimes(2));
  });

  test("owners can change visibility and see a failed save", async () => {
    await openPlay("/play?thread=game-thread");
    remote.setVisibility.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.change(screen.getByRole("combobox", { name: "Chat visibility" }), {
      target: { value: "public" },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't change visibility");
    expect(remote.setVisibility).toHaveBeenCalledExactlyOnceWith({
      threadId: "game-thread",
      visibility: "public",
    });
  });

  test("points to setup when every Scout is disabled", async () => {
    remote.queries.set("scout/activity:players", [
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
      expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({
        kind: "play",
        scoutId: "scout-1",
        visibility: "private",
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
    await openPlay("/play?thread=game-thread");
    const input = await screen.findByRole("textbox", { name: "Message Scout" });
    fireEvent.change(input, { target: { value: "Try another game." } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(remote.sendMessage).not.toHaveBeenCalled();
    expect(remote.stop).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stop Scout" }));
    await waitFor(() =>
      expect(remote.stop).toHaveBeenCalledExactlyOnceWith({ threadId: "game-thread" }),
    );
    expect(screen.getByDisplayValue("Try another game.")).toBeTruthy();
    act(() => {
      remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.sendMessage).toHaveBeenCalledExactlyOnceWith({
        threadId: "game-thread",
        prompt: "Try another game.",
      }),
    );
    act(() => {
      remote.queries.set("scout/chats:getScoutActivity", { kind: "busy" });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(screen.getByText("Busy in another session")).toBeTruthy();
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
  remote.queries.set(
    "scout/activity:get",
    session({
      title: "Learn a new game",
      purpose: { kind: "play", step: "research" },
      status: "running",
    }),
  );
  remote.queries.set("scout/chats:getScoutActivity", {
    kind: "running",
    threadId: "game-thread",
    turnId: "turn-1",
  });
  remote.messages = [
    { id: "assistant-1", role: "assistant", text: "I'll check the rules before we start." },
    { id: "user-1", role: "user", text: "Help me learn this game." },
  ];
  await openPlay("/play?thread=game-thread");
  expect(await screen.findByText("Researching the game")).toBeTruthy();
  expect(screen.getByText("I'll check the rules before we start.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret_browser_code");
  expect(document.body.textContent).not.toContain("private reasoning");
  fireEvent.change(screen.getByLabelText("Message Scout"), {
    target: { value: "I'll be back in a minute." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Show Scout’s view" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByDisplayValue("I'll be back in a minute.")).toBeTruthy();
  expect(remote.sendMessage).not.toHaveBeenCalled();
});

test("Enter sends a message but composition and Shift+Enter do not", async () => {
  await openPlay("/play?thread=game-thread");
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
  remote.queries.set(
    "scout/activity:get",
    session({ sessions: [{ engine: "convex_agent", sessionId: "session-1", kind: "active" }] }),
  );
  remote.queries.set("scout/activity:liveView", {
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
  await openPlay("/play?thread=game-thread");
  const browser = await screen.findByTitle("Scout's live browser");
  fireEvent.click(screen.getByRole("button", { name: "Show Scout’s view" }));
  expect(screen.getByTitle("Scout's live browser")).toBe(browser);
  expect(screen.getByRole("link", { name: "Open browser handoff" }).getAttribute("href")).toBe(
    "/handoff/handoff-1",
  );
  expect(screen.getAllByRole("button", { name: "Stop Scout" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByTitle("Scout's live browser")).toBe(browser);
  fireEvent.click(screen.getByRole("button", { name: "Cancel handoff" }));
  await waitFor(() =>
    expect(remote.stop).toHaveBeenCalledExactlyOnceWith({ threadId: "game-thread" }),
  );
});

test("selects older replays without changing the conversation or current handoff", async () => {
  const sessions = [
    { engine: "convex_agent", sessionId: "older", createdAt: 1_000, kind: "closed" },
    { engine: "convex_agent", sessionId: "current", createdAt: 2_000, kind: "active" },
  ];
  remote.queries.set("scout/activity:get", session({ sessions }));
  remote.queries.set("scout/activity:liveView:current", { url: "about:blank" });
  remote.queries.set("humanHandoffs:forSession:current", {
    handoffId: "current-handoff",
    status: "available",
    reason: "Complete the verification.",
    requestedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  remote.queries.set("humanHandoffs:forSession:older", null);
  const router = await openPlay("/play?thread=game-thread");
  fireEvent.click(screen.getByRole("button", { name: "Show Scout’s view" }));
  const selector = screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" });
  expect(selector.value).toBe("current");
  expect(Array.from(selector.options, (option) => option.value)).toEqual(["current", "older"]);
  fireEvent.change(screen.getByLabelText("Message Scout"), {
    target: { value: "Keep this draft." },
  });
  fireEvent.change(selector, { target: { value: "older" } });
  await waitFor(() => expect(remote.listReplayPages).toHaveBeenCalledWith({ sessionId: "older" }));
  expect(router.state.location.search.session).toBe("older");
  const bookmark = router.state.location.href;
  expect(screen.queryByTitle("Scout's live browser")).toBeNull();
  expect(screen.getByRole("link", { name: "Open browser handoff" }).getAttribute("href")).toBe(
    "/handoff/current-handoff",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByDisplayValue("Keep this draft.")).toBeTruthy();
  expect(remote.sendMessage).not.toHaveBeenCalled();
  expect(remote.stop).not.toHaveBeenCalled();

  act(() => router.history.back());
  await waitFor(() =>
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" }).value).toBe(
      "current",
    ),
  );
  act(() => router.history.forward());
  await waitFor(() =>
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" }).value).toBe(
      "older",
    ),
  );

  act(() => {
    remote.queries.set(
      "scout/activity:get",
      session({
        sessions: [
          ...sessions,
          { engine: "convex_agent", sessionId: "newest", createdAt: 3_000, kind: "active" },
        ],
      }),
    );
    remote.revision += 1;
    remote.subscribers.forEach((listener) => listener());
  });
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" }).value).toBe(
    "older",
  );
  cleanup();
  await openPlay(bookmark);
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" }).value).toBe(
    "older",
  );
});

test("follows new browser sessions until the user chooses a session", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      sessions: [{ engine: "convex_agent", sessionId: "first", createdAt: 1_000, kind: "active" }],
    }),
  );
  remote.queries.set("scout/activity:liveView:first", { url: "about:blank#first" });
  await openPlay("/play?thread=game-thread");
  expect(screen.queryByRole("combobox", { name: "Browser session" })).toBeNull();
  expect(screen.getByTitle("Scout's live browser").getAttribute("src")).toBe("about:blank#first");
  act(() => {
    remote.queries.set(
      "scout/activity:get",
      session({
        sessions: [
          { engine: "convex_agent", sessionId: "first", createdAt: 1_000, kind: "closed" },
          { engine: "convex_agent", sessionId: "second", createdAt: 2_000, kind: "active" },
        ],
      }),
    );
    remote.queries.set("scout/activity:liveView:second", { url: "about:blank#second" });
    remote.revision += 1;
    remote.subscribers.forEach((listener) => listener());
  });
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Browser session" }).value).toBe(
    "second",
  );
  expect(screen.getByTitle("Scout's live browser").getAttribute("src")).toBe("about:blank#second");
  expect(remote.sendMessage).not.toHaveBeenCalled();
  expect(remote.stop).not.toHaveBeenCalled();
});
