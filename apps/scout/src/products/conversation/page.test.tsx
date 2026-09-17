// @vitest-environment happy-dom

import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { Route as SiteRoute } from "../../routes/sites.$site";
import { reviewFeedSearch } from "../../lib/reviewFeedSearch";
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
  signIn: vi.fn(),
  queryCalls: vi.fn(),
  listReplayPages: vi.fn(),
  screenshotUrl: vi.fn(),
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
      "threadId" in args
    ) {
      const scopedKey = `scout/activity:get:${String(args.threadId)}`;
      if (remote.queries.has(scopedKey)) return remote.queries.get(scopedKey);
    }
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
    if (getFunctionName(reference) === "agentsApi/screenshots:imageUrl")
      return remote.screenshotUrl;
    if (getFunctionName(reference) === "browserReplay:listPages") return remote.listReplayPages;
    throw new Error("Unexpected action");
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    remote.queryCalls(getFunctionName(reference), args);
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
  remote.screenshotUrl.mockReset().mockResolvedValue(null);
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
  remote.queries.set("scout/activity:list", {
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  });
  remote.queries.set("scout/chats:getScoutActivity", { kind: "idle" });
  remote.createThread.mockReset().mockResolvedValue({ threadId: "game-thread" });
  remote.sendMessage.mockReset().mockResolvedValue(null);
  remote.stop.mockReset().mockResolvedValue(null);
  remote.sendManaged.mockReset().mockResolvedValue(null);
  remote.stopManaged.mockReset().mockResolvedValue(null);
  remote.resumeManaged.mockReset().mockResolvedValue(null);
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
  const directory = createRoute({
    getParentRoute: () => root,
    path: "/",
    staticData: { access: "access_public" },
    validateSearch: reviewFeedSearch,
  });
  const site = createRoute({
    getParentRoute: () => root,
    path: "/sites/$site",
    staticData: { access: "access_public" },
    ...omitNullish({ validateSearch: SiteRoute.options.validateSearch }),
  });
  const router = createRouter({
    routeTree: root.addChildren([route, review, directory, site]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("a completed managed Review opens its walkthrough and pairs replay with Chat", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("agentsApi/walkthrough:get", {
    walkthrough: {
      summary: "The game works.",
      sections: [
        {
          heading: "Undo a move",
          explanation: "The board returned to its previous state.",
          captureIds: ["capture-1"],
        },
      ],
    },
    captures: [
      {
        id: "capture-1",
        note: "Undo restores the board",
        browserSequence: 0,
        operationSequence: 1,
        state: { kind: "pending" },
      },
    ],
  });
  const router = await openPlay("/review?thread=game-thread");
  expect(await screen.findByRole("heading", { name: "Undo a move" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Walkthrough with Scout" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Review views" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Walkthrough" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.queryByRole("region", { name: "Scout's browser" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show replay" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Chat & replay" }));
  expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Scout's browser" })).toBeTruthy();
  expect(router.state.location.search).toMatchObject({ view: "chat" });
  const bookmark = router.state.location.href;
  act(() => router.history.back());
  expect(await screen.findByRole("heading", { name: "Undo a move" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Scout's browser" })).toBeNull();
  cleanup();
  await openPlay(bookmark);
  expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Scout's browser" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Undo a move" })).toBeNull();
});

test("a report arriving during a running Review keeps the reader in Chat and preserves the draft", async () => {
  const running = session({
    purpose: { kind: "review" },
    status: "running",
    hasWalkthrough: false,
    runtime: { kind: "agents_api", sessionId: "managed-1" },
  });
  remote.queries.set("scout/activity:get", running);
  remote.queries.set("agentsApi/sessions:controls", {
    state: { kind: "running" },
    canStop: true,
    canSend: false,
  });
  remote.queries.set("agentsApi/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/review?thread=game-thread");
  expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Message Scout"), {
    target: { value: "Keep this thought" },
  });
  act(() => {
    remote.queries.set("scout/activity:get", {
      ...running,
      status: "finished",
      hasWalkthrough: true,
    });
    remote.queries.set("agentsApi/sessions:controls", {
      state: { kind: "idle" },
      canStop: false,
      canSend: true,
    });
    remote.queries.set("agentsApi/walkthrough:get", {
      walkthrough: {
        summary: "The game works.",
        sections: [
          {
            heading: "Start again",
            explanation: "New game clears the board.",
            captureIds: ["capture-1"],
          },
        ],
      },
      captures: [
        {
          id: "capture-1",
          note: "New game clears the board",
          browserSequence: 0,
          operationSequence: 1,
          state: { kind: "pending" },
        },
      ],
    });
    remote.revision += 1;
    remote.subscribers.forEach((listener) => listener());
  });
  expect(screen.getByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Start again" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Walkthrough" }));
  expect(await screen.findByRole("heading", { name: "Start again" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Ask a follow-up" }));
  expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  expect(screen.getByDisplayValue("Keep this thought")).toBeTruthy();
  expect(remote.sendManaged).not.toHaveBeenCalled();
});

test("a direct walkthrough link shows an older task's empty state without forcing a report", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: false,
      runtime: { kind: "agents_api", sessionId: "managed-1" },
    }),
  );
  remote.queries.set("agentsApi/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/review?thread=game-thread&view=walkthrough");
  expect(await screen.findByRole("heading", { name: "No screenshots saved" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Chat & replay" })).toBeTruthy();
  expect(remote.sendManaged).not.toHaveBeenCalled();
});

test("desktop Chat always shows its replay and Walkthrough occupies the full layout", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("agentsApi/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/review?thread=game-thread");
  expect(await screen.findByRole("heading", { name: "No screenshots saved" })).toBeTruthy();
  for (let visit = 0; visit < 2; visit += 1) {
    expect(screen.queryByRole("region", { name: "Scout's browser" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize Scout’s view" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Chat & replay" }));
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
    const pane = screen
      .getByRole("region", { name: "Scout's browser" })
      .closest("[data-pane-side]");
    expect(pane?.hasAttribute("data-desktop-open")).toBe(true);
    expect(screen.queryByRole("button", { name: /Show replay|Hide replay/ })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Walkthrough" }));
    expect(await screen.findByRole("heading", { name: "No screenshots saved" })).toBeTruthy();
  }
});

test("mobile Review keeps replay in Chat without pane toggles", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "agents_api", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("agentsApi/walkthrough:get", { walkthrough: null, captures: [] });
  const router = await openPlay("/review?thread=game-thread");
  await screen.findByRole("navigation", { name: "Review views" });
  for (const { label, view } of [
    { label: "Chat & replay", view: "chat" },
    { label: "Walkthrough", view: "walkthrough" },
    { label: "Chat & replay", view: "chat" },
  ]) {
    fireEvent.click(screen.getByRole("link", { name: label }));
    await waitFor(() => expect(router.state.location.search.view).toBe(view));
    expect(screen.getByRole("link", { name: label }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("region", { name: "Scout's browser" }) !== null).toBe(
      view === "chat",
    );
    expect(
      screen.queryByRole("button", { name: /Show replay|Hide replay|Back to chat/ }),
    ).toBeNull();
  }
});

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
  remote.messages = [
    { kind: "message", id: "message-1", role: "assistant", text: "I opened the site." },
  ];
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
    remote.messages = [
      { kind: "message", id: "message-1", role: "assistant", text: "I opened the site." },
    ];
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

test.each([
  { visibility: "public", scope: "public" },
  { visibility: "private", scope: "mine" },
  { visibility: "public", scope: "mine" },
])(
  "the task sidebar survives delayed navigation between $visibility reviews",
  async ({ visibility, scope }) => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
    // happy-dom has no layout measurements; give the real sidebar a desktop viewport.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1280, 720),
    );
    const first = session({
      title: "Test signup",
      purpose: { kind: "review" },
      primarySite: "samebase.com",
      visibility,
    });
    const second = session({
      threadId: "second-review",
      title: "Test export",
      purpose: { kind: "review" },
      primarySite: "samebase.com",
      visibility,
    });
    remote.queries.set("scout/activity:get", first);
    remote.queries.set("scout/activity:get:second-review", undefined);
    remote.queries.set("scout/activity:list", {
      results: [first, second],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    const router = await openPlay(
      `/review?thread=game-thread&session=old-browser&view=chat&scope=${scope}&site=samebase.com`,
    );
    const nav = await screen.findByRole("navigation", { name: "Tasks for samebase.com" });
    const resize = screen.getByRole("separator", { name: "Resize task navigation" });
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    const resizedWidth = resize.getAttribute("aria-valuenow");
    expect(Number(resizedWidth)).toBeGreaterThan(260);
    const scrollport = nav.closest<HTMLElement>("[data-sidebar-layout-part='pane-scrollport']");
    if (!scrollport) throw new Error("Task navigation needs a scroll container");
    scrollport.scrollTop = 180;
    fireEvent.change(screen.getByLabelText("Message Scout"), {
      target: { value: "First task draft" },
    });
    expect(remote.queryCalls).toHaveBeenCalledWith("scout/activity:list", {
      site: "samebase.com",
      scope,
    });
    expect(
      within(nav)
        .getByRole("link", { name: /Test signup/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    await userEvent.setup().click(within(nav).getByRole("link", { name: /Test export/ }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        thread: "second-review",
        view: "chat",
        scope,
        site: "samebase.com",
      }),
    );
    expect(await screen.findByText("Opening task…")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Tasks for samebase.com" })).toBe(nav);
    expect(scrollport.scrollTop).toBe(180);
    expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
    expect(
      within(nav)
        .getByRole("link", { name: /Test export/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    act(() => {
      remote.queries.set("scout/activity:get:second-review", second);
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(await screen.findByRole("heading", { name: "Test export" })).toBeTruthy();
    const nextNav = screen.getByRole("navigation", { name: "Tasks for samebase.com" });
    expect(nextNav).toBe(nav);
    expect(scrollport.scrollTop).toBe(180);
    expect(resize.getAttribute("aria-valuenow")).toBe(resizedWidth);
    const siteLink = screen.getByRole("link", { name: "samebase.com tasks" });
    const siteUrl = new URL(siteLink.getAttribute("href") ?? "", "http://localhost");
    expect(siteUrl.searchParams.get("site")).toBe("samebase.com");
    expect(siteUrl.searchParams.get("scope")).toBe(scope);
    expect(screen.queryByDisplayValue("First task draft")).toBeNull();
    expect(
      within(nextNav)
        .getByRole("link", { name: /Test export/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(nextNav)
        .getByRole("link", { name: /Test signup/ })
        .getAttribute("aria-current"),
    ).toBeNull();
    act(() => router.history.back());
    expect(await screen.findByRole("heading", { name: "Test signup" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Tasks for samebase.com" })).toBe(nav);
    expect(screen.getByRole("separator", { name: "Resize task navigation" })).toBe(resize);
    expect(resize.getAttribute("aria-valuenow")).toBe(resizedWidth);
    act(() => router.history.forward());
    expect(await screen.findByRole("heading", { name: "Test export" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Tasks for samebase.com" })).toBe(nav);
  },
);

test("a directly opened older task remains selected even before its list page loads", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      title: "Older review",
      purpose: { kind: "review" },
      primarySite: "samebase.com",
    }),
  );
  await openPlay("/review?thread=game-thread");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show tasks" }));
  const nav = screen.getByRole("navigation", { name: "Tasks for samebase.com" });
  expect(
    within(nav)
      .getByRole("link", { name: /Older review/ })
      .getAttribute("aria-current"),
  ).toBe("page");
  await user.click(within(nav).getByRole("link", { name: /Older review/ }));
  expect(
    (await screen.findByRole("button", { name: "Show tasks" })).getAttribute("aria-expanded"),
  ).toBe("false");
});

describe("Play invitation", () => {
  test("a Review owner can follow its site without an editing control", async () => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, primarySite: "samebase.com" }),
    );
    const router = await openPlay("/review?thread=game-thread");
    expect(
      (await screen.findByRole("link", { name: "samebase.com tasks" })).getAttribute("href"),
    ).toBe("/sites/samebase.com?scope=mine&view=tasks");
    expect(screen.queryByRole("link", { name: "New chat" })).toBeNull();
    expect(screen.queryByRole("link", { name: "samebase.com" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit review site" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("link", { name: "samebase.com tasks" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sites/samebase.com"));
    expect(router.state.location.search).toEqual({ scope: "mine", view: "tasks" });
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
    const router = await openPlay("/review?thread=game-thread");
    const parent = await screen.findByRole("link", { name: "samebase.com tasks" });
    expect(parent.getAttribute("href")).toBe("/sites/samebase.com?scope=public&view=tasks");
    expect(screen.queryByRole("button", { name: "Edit review site" })).toBeNull();
    await userEvent.setup().click(parent);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sites/samebase.com"));
    expect(router.state.location.search).toEqual({ scope: "public", view: "tasks" });
  });

  test.each([
    { visibility: "public", scope: "public" },
    { visibility: "private", scope: "mine" },
  ])("a $visibility Review without a site returns to All sites", async ({ visibility, scope }) => {
    remote.queries.set("scout/activity:get", session({ purpose: { kind: "review" }, visibility }));
    const router = await openPlay("/review?thread=game-thread&view=chat");
    const parent = await screen.findByRole("link", { name: "All sites" });
    expect(parent.getAttribute("href")).toBe(`/?scope=${scope}`);
    expect(screen.queryByRole("button", { name: "Set review site" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New chat" })).toBeNull();
    await userEvent.setup().click(parent);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.search).toEqual({ scope });
  });

  test("Play keeps its New chat link and clears the current conversation", async () => {
    const router = await openPlay("/play?thread=game-thread");
    const parent = await screen.findByRole("link", { name: "New chat" });
    expect(parent.getAttribute("href")).toBe("/play");
    await userEvent.setup().click(parent);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(router.state.location.pathname).toBe("/play");
    expect(await screen.findByRole("button", { name: "Find a game for us" })).toBeTruthy();
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
    {
      kind: "message",
      id: "assistant-1",
      role: "assistant",
      text: "I'll check the rules before we start.",
    },
    { kind: "message", id: "user-1", role: "user", text: "Help me learn this game." },
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

test("members can inspect tool results directly in the conversation", async () => {
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    userId: "member",
    role: "role_member",
    isApproved: true,
    accessKeys: ROLE_ACCESS_GRANTS.role_member,
  });
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      visibility: "public",
      status: "finished",
      runtime: { kind: "agents_api", sessionId: "managed-1" },
    }),
  );
  remote.messages = [
    { kind: "message", id: "answer", role: "assistant", text: "The screenshot is saved." },
    {
      kind: "tool",
      id: "capture",
      tool: {
        id: "capture",
        name: "capture_screenshot",
        state: "completed",
        input: '{"note":"Editor after export"}',
        output: "Screenshot saved",
        error: null,
        preview: "Editor after export",
        links: [{ label: "Open screenshot", url: "https://example.com/capture.png" }],
        captures: [],
      },
    },
    { kind: "message", id: "request", role: "user", text: "Try the export." },
  ];
  await openPlay("/review?thread=game-thread&view=chat");
  expect(screen.queryByRole("link", { name: "Open in lab" })).toBeNull();
  const messages = screen.getByRole("log", { name: "Session messages" });
  expect(messages.textContent?.indexOf("Try the export.")).toBeLessThan(
    messages.textContent?.indexOf("capture_screenshot") ?? 0,
  );
  expect(within(messages).getByRole("link", { name: "Open screenshot" })).toBeTruthy();
  fireEvent.click(within(messages).getByRole("button", { name: "capture_screenshot: Finished" }));
  expect(within(messages).getByText("Screenshot saved")).toBeTruthy();
  expect(within(messages).getByText('{"note":"Editor after export"}')).toBeTruthy();
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
