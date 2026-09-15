// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ROLE_ACCESS_GRANTS } from "../../shared/accessModel";
import { omitNullish } from "../../shared/omitNullish";
import { AppNavigation } from "../components/app-navigation";
import { chatSearchSchema } from "../lib/chat-search";
import { RouteAccessOutlet } from "../components/route-access";
import { Route as AgentsRoute } from "../routes/agents";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import { agentsSearch, type BrowserSession, type RequestCheck, type Session } from "./model";

const remote = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  subscribers: new Set<() => void>(),
  revision: 0,
  queryCalls: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
  resume: vi.fn(),
  refresh: vi.fn(),
  loadMore: vi.fn(),
  listReplayPages: vi.fn(),
  loadPlaylist: vi.fn(),
  readFile: vi.fn(),
  executeWorkspaceCommand: vi.fn(),
  paginationStatus: "Exhausted",
}));

function subscribe(listener: () => void) {
  remote.subscribers.add(listener);
  return () => remote.subscribers.delete(listener);
}

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    const name = getFunctionName(reference);
    remote.queryCalls(name, args);
    if (args === "skip") return undefined;
    const key = `${name}:${JSON.stringify(args)}`;
    const value = remote.queries.has(key) ? remote.queries.get(key) : remote.queries.get(name);
    if (value instanceof Error) throw value;
    return value;
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    remote.queryCalls(getFunctionName(reference), args);
    return {
      results: remote.queries.get(getFunctionName(reference)),
      status: remote.paginationStatus,
      loadMore: remote.loadMore,
    };
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    switch (getFunctionName(reference)) {
      case "agentsApi/sessions:start":
        return remote.start;
      case "agentsApi/sessions:send":
        return remote.send;
      case "agentsApi/sessions:stop":
        return remote.stop;
      case "agentsApi/sessions:resume":
        return remote.resume;
      default:
        throw new Error("Unexpected mutation");
    }
  },
  useAction: (reference: FunctionReference<"action">) => {
    if (getFunctionName(reference) === "agentsApi/runtime:refresh") return remote.refresh;
    if (getFunctionName(reference) === "browserReplay:listPages") return remote.listReplayPages;
    if (getFunctionName(reference) === "browserReplay:loadPlaylist") return remote.loadPlaylist;
    if (getFunctionName(reference) === "scout/workspaceTools:readFile") return remote.readFile;
    if (
      ["scout/manual:executeTool", "scout/workspaceTools:executeSiteCommand"].includes(
        getFunctionName(reference),
      )
    )
      return remote.executeWorkspaceCommand;
    throw new Error("Unexpected action");
  },
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: async () => {} }),
}));

function session(state: Session["state"] = { kind: "idle" }) {
  return {
    _id: "session-1",
    title: "Inspect the example site",
    scoutId: "scout-1",
    scoutName: "Pip",
    state,
    active: state.kind === "starting" || state.kind === "running" || state.kind === "waiting",
    canControl: true,
    model: "gpt-5.6-luna",
    providerId: "provider-1",
    browser: null,
    usage: null,
    checks: [],
    research: null,
    checkMessage: null,
    hasChat: true,
    cost: {
      modelPricingBasis: "standard_short_context_excluding_cache_writes",
      modelEstimateUsd: null,
      webSearchUsd: 0,
      browserEstimateUsd: 0,
      browserSeconds: 0,
      reportedBrowserCredits: 0,
      unreportedBrowserSessions: 0,
      knownSubtotalUsd: 0,
      totalEstimateUsd: null,
      missing: ["model_usage"],
    } satisfies Session["cost"],
    cleanupError: null,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
  remote.queries.clear();
  remote.revision = 0;
  remote.queryCalls.mockReset();
  remote.start.mockReset().mockResolvedValue("session-1");
  remote.send.mockReset().mockResolvedValue(null);
  remote.stop.mockReset().mockResolvedValue(null);
  remote.resume.mockReset().mockResolvedValue(null);
  remote.refresh.mockReset().mockResolvedValue(null);
  remote.loadMore.mockReset();
  remote.listReplayPages.mockReset().mockResolvedValue({ status: "unavailable" });
  remote.loadPlaylist.mockReset().mockResolvedValue({ status: "ready", playlist: "#EXTM3U" });
  remote.readFile.mockReset().mockResolvedValue({
    path: "/workspace/notes.md",
    text: "Saved research",
    bytes: new TextEncoder().encode("Saved research").buffer,
  });
  remote.executeWorkspaceCommand.mockReset();
  remote.queries.set("scout/workspaces:list", {
    exists: true,
    configured: true,
    cwd: "/workspace",
    revision: 1,
    entries: [
      {
        kind: "file",
        path: "/workspace/notes.md",
        key: "private-session-key",
        size: 14,
        sha256: "hash",
        mode: 0o644,
        mtime: 1,
      },
    ],
  });
  remote.paginationStatus = "Exhausted";
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    role: "role_staff",
    accessKeys: ROLE_ACCESS_GRANTS.role_staff,
  });
  remote.queries.set("agentsApi/sessions:list", [{ ...session(), _creationTime: 1 }]);
  remote.queries.set("agentsApi/sessions:get", session());
  remote.queries.set("agentsApi/sessions:listItems", []);
  remote.queries.set("agentsApi/sessions:listBrowsers", []);
  remote.queries.set("scout/scouts:list", [
    { _id: "disabled-scout", displayName: "Disabled", status: "disabled" },
    { _id: "scout-1", displayName: "Pip", status: "active", availability: "available" },
    { _id: "scout-2", displayName: "Moss", status: "active", availability: "available" },
  ]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function updateQuery(name: string, value: unknown) {
  act(() => {
    remote.queries.set(name, value);
    remote.revision += 1;
    for (const listener of remote.subscribers) listener();
  });
}

async function open(path = "/agents") {
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () => (
      <ScoutSidebarProvider>
        <AppNavigation />
        <RouteAccessOutlet />
      </ScoutSidebarProvider>
    ),
  });
  const route = createRoute({
    getParentRoute: () => root,
    path: "/agents",
    staticData: AgentsRoute.options.staticData,
    ...omitNullish({
      component: AgentsRoute.options.component,
      validateSearch: AgentsRoute.options.validateSearch,
      errorComponent: AgentsRoute.options.errorComponent,
    }),
  });
  const router = createRouter({
    scrollRestoration: true,
    routeTree: root.addChildren([
      route,
      createRoute({
        getParentRoute: () => root,
        path: "/chats",
        staticData: { access: "access_lab" },
        validateSearch: chatSearchSchema,
        component: () => <p>Lab fixture</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test.each(["loading", "cached"])(
  "keeps the session list mounted when switching to a %s chat without carrying over its draft",
  async (queryState) => {
    const secondSession = { ...session(), _id: "session-2", title: "Check another site" };
    const secondSessionQuery = 'agentsApi/sessions:get:{"sessionId":"session-2"}';
    remote.queries.set("agentsApi/sessions:list", [session(), secondSession]);
    remote.queries.set(secondSessionQuery, queryState === "cached" ? secondSession : undefined);
    const router = await open("/agents?session=session-1");
    fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), {
      target: { value: "First chat draft" },
    });
    const navigation = screen.getByRole("navigation", { name: "Agent sessions" });
    const scroller = navigation.closest("[data-scroll-restoration-id]");
    if (!scroller) throw new Error("Session list has no scroll container");
    scroller.scrollTop = 240;
    const newLink = screen.getByRole("link", { name: "New" });
    const rightPane = document.querySelector('[data-pane-side="right"]');
    expect(rightPane).not.toBeNull();

    fireEvent.click(within(navigation).getByRole("link", { name: "Check another site Pip" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ session: "session-2" }));
    if (queryState === "loading") {
      expect(await screen.findByText("Opening session…")).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
      expect(screen.getByRole("navigation", { name: "Agent sessions" })).toBe(navigation);
      expect(screen.getByRole("link", { name: "New" })).toBe(newLink);
      expect(document.querySelector('[data-pane-side="right"]')).toBe(rightPane);
      expect(scroller.scrollTop).toBe(240);
      updateQuery(secondSessionQuery, secondSession);
    }

    expect(await screen.findByRole("heading", { name: "Check another site" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Agent sessions" })).toBe(navigation);
    expect(screen.getByRole("link", { name: "New" })).toBe(newLink);
    expect(document.querySelector('[data-pane-side="right"]')).toBe(rightPane);
    expect(scroller.scrollTop).toBe(240);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Second chat message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.send).toHaveBeenCalledWith({
        sessionId: "session-2",
        message: "Second chat message",
      }),
    );
  },
);

test("keeps navigation available for a missing session and the new session form", async () => {
  remote.queries.set("agentsApi/sessions:get", null);
  await open("/agents?session=session-1");
  expect(await screen.findByText("Session not found.")).toBeTruthy();
  const navigation = screen.getByRole("navigation", { name: "Agent sessions" });
  fireEvent.click(screen.getByRole("link", { name: "New" }));
  expect(await screen.findByRole("heading", { name: "New session" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Agent sessions" })).toBe(navigation);
});

test("opens session files through a shareable URL and preserves the conversation draft", async () => {
  const router = await open("/agents?session=session-1");
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
  fireEvent.click(await screen.findByRole("button", { name: "notes.md" }));
  expect((await screen.findByLabelText("File contents")).textContent).toBe("Saved research");
  expect(remote.readFile).toHaveBeenCalledWith({
    target: { kind: "agent_session", sessionId: "session-1" },
    path: "/workspace/notes.md",
  });
  expect(router.state.location.search).toMatchObject({
    view: "workspace",
    file: "/workspace/notes.md",
  });
  expect(screen.queryByRole("textbox", { name: "Bash command" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
  expect(await screen.findByRole("textbox", { name: "Message" })).toHaveProperty(
    "value",
    "Keep this draft",
  );
  expect(remote.executeWorkspaceCommand).not.toHaveBeenCalled();
});

function initialCheck() {
  return {
    _id: "check-initial",
    _creationTime: 1_000,
    sessionId: "session-1",
    kind: "initial",
    model: "gpt-5.6-luna",
    prompt: "Original review request",
    cost: 0.000096,
    state: {
      kind: "completed",
      finishedAt: 3_500,
      call: {
        startedAt: 1_000,
        request: '{"input":"Original review request"}',
        response: '{"id":"response-initial"}',
        usage: { inputTokens: 300, outputTokens: 30, cachedInputTokens: 0 },
      },
      result: {
        kind: "initial",
        title: "Inspect the example site",
        decision: { kind: "approved" },
      },
    } satisfies RequestCheck["state"],
  };
}

function resumeCheck() {
  return {
    _id: "check-resume-1",
    _creationTime: 5_000,
    sessionId: "session-1",
    kind: "resume",
    model: "resume-model",
    prompt: "Stored resume instructions",
    cost: 0.00024,
    handoff: { callId: "call-1", turnId: "turn-1", message: "Complete verification" },
    providerSessionId: "provider-browser-1",
    evidence: {
      capturedAt: 5_500,
      pages: [
        {
          tabId: "tab-1",
          url: "https://example.test/login",
          title: "Sign in",
          content: "Verification is still required.",
        },
      ],
    },
    state: {
      kind: "completed",
      finishedAt: 8_000,
      call: {
        startedAt: 6_000,
        request: '{"input":"Fresh browser content"}',
        response: '{"id":"response-resume-1"}',
        usage: { inputTokens: 600, outputTokens: 50, cachedInputTokens: 0 },
      },
      result: {
        kind: "resume",
        decision: { kind: "rejected", reason: "Finish verification before resuming." },
      },
    } satisfies RequestCheck["state"],
  };
}

function inspectKey(checkId: string) {
  return `agentsApi/requestChecks:inspect:${JSON.stringify({ sessionId: "session-1", checkId })}`;
}

test("keeps one full Chat and chronological sibling checks with independent selection and inspectors", async () => {
  const initial = initialCheck();
  const firstResume = resumeCheck();
  const secondResume = {
    ...resumeCheck(),
    _id: "check-resume-2",
    _creationTime: 9_000,
    cost: 0.00036,
    evidence: {
      capturedAt: 9_500,
      pages: [
        {
          tabId: "tab-1",
          url: "https://example.test/dashboard",
          title: "Dashboard",
          content: "Signed in as Pip.",
        },
      ],
    },
    state: {
      kind: "completed",
      finishedAt: 13_000,
      call: {
        ...firstResume.state.call,
        request: '{"input":"Signed in as Pip"}',
        response: '{"id":"response-resume-2"}',
      },
      result: { kind: "resume", decision: { kind: "approved" } },
    } satisfies RequestCheck["state"],
  };
  const checks = [
    { _id: initial._id, kind: "initial", status: "approved", cost: initial.cost },
    { _id: firstResume._id, kind: "resume", status: "rejected", cost: firstResume.cost },
    { _id: secondResume._id, kind: "resume", status: "approved", cost: secondResume.cost },
  ];
  remote.queries.set("agentsApi/sessions:get", {
    ...session(),
    checks,
  });
  remote.queries.set("agentsApi/sessions:list", [{ ...session(), checks }]);
  remote.queries.set(inspectKey(initial._id), initial);
  remote.queries.set(inspectKey(firstResume._id), firstResume);
  remote.queries.set(inspectKey(secondResume._id), secondResume);
  remote.queries.set("agentsApi/sessions:listItems", [
    { _id: "message-1", kind: "user", sequence: 1, text: "Before the handoff", details: null },
    { _id: "message-2", kind: "assistant", sequence: 2, text: "After the handoff", details: null },
  ]);
  const router = await open("/agents?session=session-1");
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), {
    target: { value: "Keep my draft" },
  });
  const navigation = within(screen.getByRole("navigation", { name: "Agent sessions" }));
  const chatLinks = navigation.getAllByRole("link", { name: "Chat" });
  expect(chatLinks).toHaveLength(1);
  const checkLinks = navigation.getAllByRole<HTMLAnchorElement>("link", { name: /check ·/ });
  expect(checkLinks.map((link) => new URL(link.href).searchParams.get("check"))).toEqual([
    initial._id,
    firstResume._id,
    secondResume._id,
  ]);
  const siblings = chatLinks[0].closest("li")?.parentElement;
  expect(siblings?.children).toHaveLength(4);
  for (const link of checkLinks) expect(link.closest("li")?.parentElement).toBe(siblings);
  expect(siblings?.querySelector("ul")).toBeNull();
  expect(screen.getByText("Before the handoff")).toBeTruthy();
  expect(screen.getByText("After the handoff")).toBeTruthy();
  fireEvent.click(navigation.getByRole("link", { name: "Request check · approved" }));
  expect(await screen.findByRole("heading", { name: "Request check" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Call details" })).toBeTruthy();
  expect(screen.getByText("2.5s")).toBeTruthy();
  expect(screen.getByText("$0.000096 estimated")).toBeTruthy();
  expect(router.state.location.search).toMatchObject({ step: "request_check", check: initial._id });
  expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
  fireEvent.click(screen.getByText("Request", { exact: true }));
  expect(screen.getByText(/"input": "Original review request"/)).toBeTruthy();
  fireEvent.click(navigation.getByRole("link", { name: "Resume check · rejected" }));
  expect(await screen.findByRole("heading", { name: "Resume check" })).toBeTruthy();
  expect(screen.getByText("Finish verification before resuming.")).toBeTruthy();
  expect(screen.getByText("resume-model")).toBeTruthy();
  expect(screen.getByText("3.0s")).toBeTruthy();
  expect(screen.getByText("$0.000240 estimated")).toBeTruthy();
  expect(screen.queryByText("Title", { exact: true })).toBeNull();
  expect(screen.queryByText("Original review request")).toBeNull();
  await userEvent.setup().click(screen.getByText("Sign in", { exact: true }));
  expect(screen.getByText("Verification is still required.")).toBeTruthy();
  fireEvent.click(navigation.getByRole("link", { name: "Resume check · approved" }));
  expect(await screen.findByText("$0.000360 estimated")).toBeTruthy();
  expect(screen.getByText("4.0s")).toBeTruthy();
  expect(screen.queryByText("Finish verification before resuming.")).toBeNull();
  expect(screen.queryByText("Sign in", { exact: true })).toBeNull();
  expect(
    navigation.getByRole("link", { name: "Resume check · approved" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    navigation.getByRole("link", { name: "Request check · approved" }).hasAttribute("aria-current"),
  ).toBe(false);
  fireEvent.click(screen.getByText("Response", { exact: true }));
  expect(screen.getByText(/"id": "response-resume-2"/)).toBeTruthy();
  act(() => router.history.back());
  expect(await screen.findByText("Finish verification before resuming.")).toBeTruthy();
  expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/requestChecks:inspect", {
    sessionId: "session-1",
    checkId: firstResume._id,
  });
  fireEvent.click(navigation.getByRole("link", { name: "Chat" }));
  expect(await screen.findByRole("textbox", { name: "Message" })).toHaveProperty(
    "value",
    "Keep my draft",
  );
  expect(screen.queryByRole("heading", { name: "Call details" })).toBeNull();
  expect(router.state.location.search.check).toBeUndefined();
  expect(screen.getByText("Before the handoff")).toBeTruthy();
  expect(screen.getByText("After the handoff")).toBeTruthy();
});

test.each(["", "&step=request_check"])(
  "opens the initial check without an ID at %s",
  async (search) => {
    const check = { ...initialCheck(), cost: null, state: { kind: "pending" } };
    const checks = [{ _id: check._id, kind: "initial", status: "pending", cost: null }];
    remote.queries.set("agentsApi/sessions:get", {
      ...session({ kind: "starting" }),
      providerId: undefined,
      checks,
    });
    remote.queries.set("agentsApi/sessions:list", [{ ...session(), checks, hasChat: false }]);
    remote.queries.set(inspectKey(check._id), check);
    await open(`/agents?session=session-1${search}`);
    expect(await screen.findByRole("heading", { name: "Request check" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Chat" })).toBeNull();
    expect(screen.getByText("Original review request")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" }));
  },
);

test.each([null, new Error("Check does not belong to this session")])(
  "does not replace an invalid explicit check with the initial check: %s",
  async (result) => {
    const initial = initialCheck();
    remote.queries.set("agentsApi/sessions:get", {
      ...session(),
      checks: [{ _id: initial._id, kind: "initial", status: "approved", cost: initial.cost }],
    });
    remote.queries.set(inspectKey(initial._id), initial);
    remote.queries.set(inspectKey("foreign-check"), result);
    await open("/agents?session=session-1&step=request_check&check=foreign-check");
    expect(
      await screen.findByText(result instanceof Error ? result.message : "Check not found."),
    ).toBeTruthy();
    expect(screen.queryByText("Original review request")).toBeNull();
    expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/requestChecks:inspect", {
      sessionId: "session-1",
      checkId: "foreign-check",
    });
    expect(remote.queryCalls).not.toHaveBeenCalledWith("agentsApi/requestChecks:inspect", {
      sessionId: "session-1",
      checkId: initial._id,
    });
  },
);

test("a bookmarked resume check loads its own evidence capture failure without a model call", async () => {
  const check = {
    ...resumeCheck(),
    evidence: null,
    cost: null,
    state: {
      kind: "failed",
      error: "Could not capture browser evidence.",
      finishedAt: 7_000,
      call: null,
    } satisfies RequestCheck["state"],
  };
  remote.queries.set("agentsApi/sessions:get", {
    ...session(),
    checks: [{ _id: check._id, kind: "resume", status: "failed", cost: null }],
  });
  await open(`/agents?session=session-1&step=request_check&check=${check._id}`);
  expect(await screen.findByText("Opening check…")).toBeTruthy();
  updateQuery(inspectKey(check._id), check);
  expect(await screen.findByRole("heading", { name: "Resume check" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Could not capture browser evidence.");
  expect(screen.getByText("Not captured")).toBeTruthy();
  expect(screen.getByText("Stored resume instructions")).toBeTruthy();
  expect(screen.getByText("Complete verification")).toBeTruthy();
  expect(screen.getByText("2.0s")).toBeTruthy();
  expect(screen.getByText("Not reported")).toBeTruthy();
  expect(screen.queryByText("Request", { exact: true })).toBeNull();
  expect(screen.queryByText("Response", { exact: true })).toBeNull();
  expect(screen.queryByText("Input tokens")).toBeNull();
});

test("failed model calls retain their stored request and plain-text response", async () => {
  const resume = resumeCheck();
  const check = {
    ...resume,
    state: {
      kind: "failed",
      error: "The model request failed.",
      finishedAt: 8_000,
      call: { ...resume.state.call, response: "Provider unavailable" },
    } satisfies RequestCheck["state"],
  };
  remote.queries.set(inspectKey(check._id), check);
  await open(`/agents?session=session-1&step=request_check&check=${check._id}`);
  expect(await screen.findByRole("heading", { name: "Resume check" })).toBeTruthy();
  fireEvent.click(screen.getByText("Request", { exact: true }));
  fireEvent.click(screen.getByText("Response", { exact: true }));
  expect(screen.getByText(/"input": "Fresh browser content"/)).toBeTruthy();
  expect(screen.getByText("Provider unavailable")).toBeTruthy();
});

test("waiting keeps the blocked check reason and checking prevents resume and sends while allowing Stop", async () => {
  remote.queries.set("agentsApi/sessions:get", {
    ...session({
      kind: "waiting",
      message: "Sign in to continue.",
      callId: "call-current",
      turnId: "turn-current",
    }),
    checkMessage: "Finish verification before resuming.",
  });
  await open("/agents?session=session-1");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Finish verification before resuming.",
  );
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() =>
    expect(remote.resume).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session-1",
      callId: "call-current",
      turnId: "turn-current",
    }),
  );
  updateQuery("agentsApi/sessions:get", {
    ...session(),
    state: { kind: "checking", checkId: "check-resume-2" },
    active: true,
  });
  expect(await screen.findByText("Checking browser…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(screen.queryByText("Finish verification before resuming.")).toBeNull();
  const draft = screen.getByLabelText<HTMLTextAreaElement>("Message");
  expect(draft.value).toBe("Keep this draft");
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true);
  fireEvent.keyDown(draft, { key: "Enter" });
  expect(remote.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" }));
  expect(remote.resume).toHaveBeenCalledTimes(1);
});

test("admins can open member session files directly without gaining session controls", async () => {
  remote.queries.set("agentsApi/sessions:get", { ...session(), canControl: false });
  await open("/agents?session=session-1&view=workspace&file=%2Fworkspace%2Fnotes.md");
  expect((await screen.findByLabelText("File contents")).textContent).toBe("Saved research");
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Bash command" })).toBeNull();
});

test("starts with an active scout and opens the new session without mutating on page load", async () => {
  const router = await open();
  await screen.findByRole("heading", { name: "New session" });
  expect(remote.start).not.toHaveBeenCalled();
  expect(screen.queryByRole("option", { name: "Disabled" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Scout"), { target: { value: "scout-1" } });
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "  Inspect the site  " } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() =>
    expect(remote.start).toHaveBeenCalledWith({ scoutId: "scout-1", prompt: "Inspect the site" }),
  );
  await waitFor(() => expect(router.state.location.search).toEqual({ session: "session-1" }));
  expect(await screen.findByLabelText("Message")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("link", { name: "New" }));
  expect(await screen.findByRole("heading", { name: "New session" })).toBeTruthy();
  expect(router.state.location.search).toEqual({});
});

test("shows start failures and preserves the prompt for an explicit retry", async () => {
  remote.start.mockRejectedValueOnce(new Error("This Scout is already working"));
  await open();
  const prompt = await screen.findByLabelText<HTMLTextAreaElement>("Prompt");
  fireEvent.change(prompt, { target: { value: "Keep this prompt" } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect((await screen.findByRole("alert")).textContent).toBe("This Scout is already working");
  expect(prompt.value).toBe("Keep this prompt");
  expect(remote.start).toHaveBeenCalledTimes(1);
});

test("a saved link opens a session outside the recent list through the validated get query", async () => {
  remote.queries.set("agentsApi/sessions:list", []);
  await open("/agents?session=session-1");
  expect(await screen.findByLabelText("Message")).toBeTruthy();
  expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/sessions:get", {
    sessionId: "session-1",
  });
  expect(remote.start).not.toHaveBeenCalled();
});

test("loads older sessions from the sidebar", async () => {
  remote.paginationStatus = "CanLoadMore";
  await open();
  fireEvent.click(await screen.findByRole("button", { name: "Load more sessions" }));
  expect(remote.loadMore).toHaveBeenCalledExactlyOnceWith(50);
});

test("admins can inspect another user's transcript without owner controls", async () => {
  remote.queries.set("agentsApi/sessions:get", {
    ...session({
      kind: "waiting",
      message: "Complete verification",
      callId: "call",
      turnId: "turn",
    }),
    canControl: false,
  });
  remote.queries.set("agentsApi/sessions:listItems", [
    { _id: "reply", sequence: 1, kind: "assistant", text: "I opened the site.", details: "" },
  ]);
  await open("/agents?session=session-1");
  expect(await screen.findByText("I opened the site.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
});

test("invalid session IDs surface the query error without mounting the transcript", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  remote.queries.set("agentsApi/sessions:get", new Error("Invalid session ID"));
  await open("/agents?session=invalid");
  expect(await screen.findByRole("heading", { name: "Could not open Agents" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Invalid session ID");
  expect(remote.queryCalls).not.toHaveBeenCalledWith(
    "agentsApi/sessions:listItems",
    expect.anything(),
  );
  expect(agentsSearch.safeParse({ session: 123 }).success).toBe(false);
});

test("members cannot mount Agents or see its navigation link", async () => {
  remote.queries.set("accounts:currentViewerAccess", {
    kind: "account",
    role: "role_member",
    accessKeys: ROLE_ACCESS_GRANTS.role_member,
  });
  await open("/agents?session=session-1");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Agents" })).toBeNull();
  expect(remote.queryCalls).not.toHaveBeenCalledWith("agentsApi/sessions:list", expect.anything());
  expect(remote.queryCalls).not.toHaveBeenCalledWith("agentsApi/sessions:get", expect.anything());
});

test("renders transcript order, expandable tool details, and manual pagination", async () => {
  remote.paginationStatus = "CanLoadMore";
  remote.queries.set("agentsApi/sessions:listItems", [
    {
      _id: "item-2",
      sequence: 2,
      kind: "function_call",
      text: "browser_execute",
      details: "await page.title()",
    },
    { _id: "item-1", sequence: 1, kind: "user", text: "Inspect the site", details: "" },
  ]);
  await open("/agents?session=session-1");
  const transcript = await screen.findByLabelText("Session transcript");
  const items = within(transcript).getAllByRole("article");
  expect(items[0]?.textContent).toContain("Inspect the site");
  expect(items[1]?.textContent).toContain("browser_execute");
  const details = transcript.querySelector("details");
  expect(details?.open).toBe(false);
  await userEvent.setup().click(within(transcript).getByText("Details"));
  expect(details?.open).toBe(true);
  expect(within(transcript).getByText("await page.title()")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(remote.loadMore).toHaveBeenCalledWith(50);
});

test("hides empty reasoning and collapses reasoning summaries while preserving full details", async () => {
  const summary = "Check the current page before choosing the next action.";
  const details = JSON.stringify({ type: "reasoning", summary: [{ text: summary }] });
  remote.queries.set("agentsApi/sessions:listItems", [
    { _id: "item-1", sequence: 1, kind: "user", text: "Inspect the site", details: "" },
    { _id: "item-2", sequence: 2, kind: "reasoning", text: "", details: "Empty reasoning payload" },
    { _id: "item-3", sequence: 3, kind: "reasoning", text: " \n ", details: "Whitespace payload" },
    { _id: "item-4", sequence: 4, kind: "reasoning", text: summary, details },
    { _id: "item-5", sequence: 5, kind: "assistant", text: "The page is open.", details: "" },
  ]);
  await open("/agents?session=session-1");
  const transcript = await screen.findByLabelText("Session transcript");
  expect(within(transcript).getAllByRole("article")).toHaveLength(3);
  expect(screen.queryByText("Empty reasoning payload")).toBeNull();
  expect(screen.queryByText("Whitespace payload")).toBeNull();
  expect(screen.getByText("Inspect the site").closest("details")).toBeNull();
  expect(screen.getByText("The page is open.").closest("details")).toBeNull();

  const reasoning = screen.getByText("Reasoning").closest("details");
  expect(reasoning?.open).toBe(false);
  expect(screen.getByText(summary).closest("details")).toBe(reasoning);
  const user = userEvent.setup();
  await user.click(screen.getByText("Reasoning"));
  expect(reasoning?.open).toBe(true);
  expect(screen.getByText(details).closest("details")?.open).toBe(false);
  await user.click(screen.getByText("Details"));
  expect(screen.getByText(details).closest("details")?.open).toBe(true);
});

test("waiting sessions expose the human browser and resume, while running sessions can stop", async () => {
  remote.queries.set("agentsApi/sessions:listBrowsers", [
    {
      _id: "browser-1",
      sequence: 1,
      lifecycle: { kind: "active", openedAtMs: 0 },
      liveViewUrl: "about:blank#preview",
      interactiveLiveViewUrl: "https://example.test/control",
    },
  ]);
  remote.queries.set("agentsApi/sessions:get", {
    ...session({
      kind: "waiting",
      message: "Sign in to continue.",
      callId: "call-1",
      turnId: "turn-1",
    }),
    browser: {
      liveViewUrl: "about:blank#preview",
      interactiveLiveViewUrl: "https://example.test/control",
    },
  });
  await open("/agents?session=session-1");
  expect(await screen.findByText("Sign in to continue.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open browser" }).getAttribute("href")).toBe(
    "https://example.test/control",
  );
  const browserFrame = screen.getByTitle("Live browser session 1");
  expect(browserFrame.getAttribute("src")).toBe("about:blank#preview");
  expect(browserFrame.getAttribute("allow")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() =>
    expect(remote.resume).toHaveBeenCalledWith({
      sessionId: "session-1",
      callId: "call-1",
      turnId: "turn-1",
    }),
  );
  updateQuery("agentsApi/sessions:get", session({ kind: "running" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Resume" })).toBeNull());
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A follow-up" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" }));
  expect(remote.send).not.toHaveBeenCalled();
});

test("send failures preserve drafts and IME Enter does not send", async () => {
  remote.send.mockRejectedValueOnce(new Error("The provider is unavailable"));
  await open("/agents?session=session-1");
  const draft = await screen.findByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "  Keep going  " } });
  fireEvent.keyDown(draft, { key: "Enter", isComposing: true });
  expect(remote.send).not.toHaveBeenCalled();
  fireEvent.keyDown(draft, { key: "Enter", shiftKey: true });
  expect(remote.send).not.toHaveBeenCalled();
  fireEvent.keyDown(draft, { key: "Enter" });
  expect((await screen.findByRole("alert")).textContent).toBe("The provider is unavailable");
  expect(draft.value).toBe("  Keep going  ");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(draft.value).toBe(""));
  expect(remote.send).toHaveBeenLastCalledWith({ sessionId: "session-1", message: "Keep going" });
});

test("stopped sessions block button and keyboard sends until cleanup releases active", async () => {
  remote.queries.set("agentsApi/sessions:get", { ...session({ kind: "stopped" }), active: true });
  await open("/agents?session=session-1");
  const draft = await screen.findByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Continue after cleanup" } });
  const sendButton = screen.getByRole<HTMLButtonElement>("button", { name: "Send message" });
  expect(sendButton.disabled).toBe(true);
  fireEvent.click(sendButton);
  fireEvent.keyDown(draft, { key: "Enter" });
  expect(remote.send).not.toHaveBeenCalled();

  updateQuery("agentsApi/sessions:get", session({ kind: "stopped" }));
  expect(sendButton.disabled).toBe(false);
  expect(draft.value).toBe("Continue after cleanup");
  fireEvent.click(sendButton);
  await waitFor(() =>
    expect(remote.send).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "Continue after cleanup",
    }),
  );
});

test("a failed cleanup remains visible and can be retried after Stop", async () => {
  remote.queries.set("agentsApi/sessions:get", {
    ...session({ kind: "stopped" }),
    active: true,
    cleanupError: "OpenAI cancellation unavailable",
  });
  await open("/agents?session=session-1");

  expect((await screen.findByRole("alert")).textContent).toBe("OpenAI cancellation unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry stop" }));
  await waitFor(() => expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" }));
  expect(screen.queryByText("Stopped")).toBeNull();
});

test("failed sessions holding active allow a manual stop retry and block sends", async () => {
  const failedSession = session({ kind: "failed", error: "Browser cleanup failed" });
  remote.queries.set("agentsApi/sessions:get", { ...failedSession, active: true });
  await open("/agents?session=session-1");
  expect((await screen.findByRole("alert")).textContent).toBe("Browser cleanup failed");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Continue" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
    true,
  );
  fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
  expect(remote.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" }));

  updateQuery("agentsApi/sessions:get", failedSession);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
    false,
  );
});

test("failed sessions show the first error line with the full stack collapsed", async () => {
  const error =
    "Error: Browser cleanup failed\n\n    at run (workflow.ts:321:9)\n    at handler (lifecycle.ts:17:35)";
  remote.queries.set("agentsApi/sessions:get", session({ kind: "failed", error }));
  await open("/agents?session=session-1");
  expect((await screen.findByRole("alert")).textContent).toBe("Error: Browser cleanup failed");
  const details = screen.getByText("Details").closest("details");
  expect(details?.open).toBe(false);
  expect(details?.querySelector("pre")?.textContent).toBe(error);
  await userEvent.setup().click(screen.getByText("Details"));
  expect(details?.open).toBe(true);
});

function browser(
  id: string,
  sequence: number,
  lifecycle: BrowserSession["lifecycle"] = { kind: "active", openedAtMs: 0 },
) {
  return {
    _id: id,
    sequence,
    lifecycle,
    liveViewUrl: lifecycle.kind === "active" ? `about:blank#${id}` : null,
    interactiveLiveViewUrl: lifecycle.kind === "active" ? `https://example.test/${id}` : null,
  };
}

const closedLifecycle = {
  kind: "closed",
  openedAtMs: 0,
  closedAtMs: 9_000,
  providerDurationMs: 9_000,
  creditsBilled: 2,
} satisfies BrowserSession["lifecycle"];

test("selects historical replay through the URL, restores browser history, and preserves drafts", async () => {
  remote.queries.set("agentsApi/sessions:listBrowsers", [
    browser("browser-1", 1, closedLifecycle),
    browser("browser-2", 2),
  ]);
  const router = await open("/agents?session=session-1");
  const picker = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Browser session",
  });
  expect(picker.value).toBe("browser-2");
  expect(screen.getByTitle("Live browser session 2").getAttribute("src")).toBe(
    "about:blank#browser-2",
  );
  const draft = screen.getByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Keep this draft" } });

  const user = userEvent.setup();
  await user.selectOptions(picker, "browser-1");
  expect(router.state.location.search).toEqual({ session: "session-1", browser: "browser-1" });
  expect(await screen.findByRole("heading", { name: "Replay" })).toBeTruthy();
  await waitFor(() =>
    expect(remote.listReplayPages).toHaveBeenCalledWith({ sessionId: "browser-1" }),
  );
  expect(screen.queryByTitle("Live browser session 2")).toBeNull();
  expect(screen.queryByRole("link", { name: "Open browser" })).toBeNull();
  expect(draft.value).toBe("Keep this draft");

  updateQuery("agentsApi/sessions:listBrowsers", [
    browser("browser-1", 1, closedLifecycle),
    browser("browser-2", 2, closedLifecycle),
    browser("browser-3", 3),
  ]);
  expect(picker.value).toBe("browser-1");
  expect(screen.queryByTitle("Live browser session 3")).toBeNull();
  act(() => router.history.back());
  expect(await screen.findByTitle("Live browser session 3")).toBeTruthy();
  act(() => router.history.forward());
  expect(await screen.findByRole("heading", { name: "Replay" })).toBeTruthy();
  expect(picker.value).toBe("browser-1");
});

test("switches a live browser through closing into the shared replay without losing the conversation", async () => {
  remote.queries.set("agentsApi/sessions:listBrowsers", [browser("browser-1", 1)]);
  await open("/agents?session=session-1&browser=browser-1");
  expect(await screen.findByTitle("Live browser session 1")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Browser session" })).toBeNull();
  const draft = screen.getByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Continue later" } });
  updateQuery("agentsApi/sessions:listBrowsers", [
    browser("browser-1", 1, { kind: "closing", openedAtMs: 0, closingAtMs: 8_000 }),
  ]);
  expect(await screen.findByText("Closing browser…")).toBeTruthy();
  expect(screen.queryByTitle("Live browser session 1")).toBeNull();
  expect(remote.listReplayPages).not.toHaveBeenCalled();
  updateQuery("agentsApi/sessions:listBrowsers", [browser("browser-1", 1, closedLifecycle)]);
  expect(await screen.findByRole("heading", { name: "Replay" })).toBeTruthy();
  await waitFor(() =>
    expect(remote.listReplayPages).toHaveBeenCalledWith({ sessionId: "browser-1" }),
  );
  expect(draft.value).toBe("Continue later");
});

test("restores recorded page selection on reload and clears it when choosing another browser", async () => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:https://scout.test/${crypto.randomUUID()}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  remote.queries.set("agentsApi/sessions:listBrowsers", [
    browser("browser-1", 1, closedLifecycle),
    browser("browser-2", 2),
  ]);
  remote.listReplayPages.mockResolvedValue({
    status: "ready",
    viewport: { width: 1280, height: 720 },
    pages: [
      { pageId: "page-1", pageUrl: "https://first.test", startTimeMs: 0, endTimeMs: 5_000 },
      { pageId: "page-2", pageUrl: "https://second.test", startTimeMs: 6_000, endTimeMs: 9_000 },
    ],
    operations: [],
  });
  const router = await open("/agents?session=session-1&browser=browser-1&replayPage=page-2");
  const secondPage = await screen.findByRole("button", { name: "second.test" });
  expect(secondPage.getAttribute("aria-pressed")).toBe("true");
  const bookmark = router.state.location.href;
  fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), {
    target: { value: "7000" },
  });
  expect(router.state.location.href).toBe(bookmark);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "first.test" }));
  expect(router.state.location.search.replayPage).toBe("page-1");
  act(() => router.history.back());
  await waitFor(() => expect(secondPage.getAttribute("aria-pressed")).toBe("true"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Browser session" }), "browser-2");
  expect(await screen.findByTitle("Live browser session 2")).toBeTruthy();
  expect(router.state.location.search.replayPage).toBeUndefined();
});

test("restores desktop sidebar visibility through history while retaining the browser and draft", async () => {
  remote.queries.set("agentsApi/sessions:listBrowsers", [browser("browser-1", 1)]);
  const router = await open("/agents?session=session-1&browser=browser-1");
  const draft = await screen.findByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Still writing" } });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Hide sessions" }));
  expect(router.state.location.search.sessions).toBe("hidden");
  await user.click(screen.getByRole("button", { name: "Hide browser" }));
  expect(router.state.location.search.inspector).toBe("hidden");
  expect(router.state.location.search.browser).toBe("browser-1");
  act(() => router.history.back());
  expect(await screen.findByRole("button", { name: "Hide browser" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show sessions" })).toBeTruthy();
  act(() => router.history.back());
  expect(await screen.findByRole("button", { name: "Hide sessions" })).toBeTruthy();
  expect(draft.value).toBe("Still writing");
  expect(
    screen.getByRole("region", { name: "Conversation" }).closest('[data-pane-side="main"]'),
  ).toBeTruthy();
});

test("keeps mobile conversation selected when a browser arrives and restores pane history", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
  const router = await open("/agents?session=session-1");
  const draft = await screen.findByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Still writing" } });
  updateQuery("agentsApi/sessions:listBrowsers", [browser("browser-1", 1)]);
  expect(screen.getByRole("button", { name: "Show browser" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Show browser" }));
  expect(router.state.location.search.pane).toBe("right");
  await user.click(screen.getByRole("button", { name: "Hide browser" }));
  expect(router.state.location.search.pane).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Show sessions" }));
  expect(router.state.location.search.pane).toBe("left");
  act(() => router.history.back());
  expect(await screen.findByRole("button", { name: "Show sessions" })).toBeTruthy();
  expect(draft.value).toBe("Still writing");
});

test("navigates sidebar panes on Agents after leaving Lab at 675px without a stale route scope", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(675);
  const warnings = vi.spyOn(console, "warn");
  const router = await open("/chats?thread=lab-thread");
  expect(await screen.findByText("Lab fixture")).toBeTruthy();
  await act(() => router.navigate({ to: "/agents", search: { session: "session-1" } }));
  expect(await screen.findByText("Cost pending")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Show browser" }));
  expect(router.state.location.pathname).toBe("/agents");
  expect(router.state.location.search).toEqual({ session: "session-1", pane: "right" });
  await user.click(screen.getByRole("button", { name: "Show sessions" }));
  expect(router.state.location.search).toEqual({ session: "session-1", pane: "left" });
  expect(warnings).not.toHaveBeenCalled();
});

test("an unknown browser link defaults to the latest record without mounting an unrelated replay", async () => {
  remote.queries.set("agentsApi/sessions:listBrowsers", [browser("browser-1", 1)]);
  await open("/agents?session=session-1&browser=another-session-browser");
  expect(await screen.findByTitle("Live browser session 1")).toBeTruthy();
  expect(remote.listReplayPages).not.toHaveBeenCalled();
  expect(remote.queryCalls).toHaveBeenCalledWith("agentsApi/sessions:listBrowsers", {
    sessionId: "session-1",
  });
});

test("shows an estimated subtotal with priced providers, unpriced browser credits, and reported tokens", async () => {
  remote.queries.set("agentsApi/sessions:get", {
    ...session(),
    usage: { inputTokens: 12_000, outputTokens: 1_500, cachedInputTokens: 2_000 },
    cost: {
      modelPricingBasis: "standard_short_context_excluding_cache_writes",
      modelEstimateUsd: 0.1234,
      webSearchUsd: 0.02,
      browserEstimateUsd: null,
      browserSeconds: 126,
      reportedBrowserCredits: 3,
      unreportedBrowserSessions: 1,
      knownSubtotalUsd: 0.1434,
      totalEstimateUsd: null,
      missing: ["browser_credits", "firecrawl_credit_price"],
    } satisfies Session["cost"],
  });
  await open("/agents?session=session-1");
  const summary = await screen.findByText("Cost · $0.1434 subtotal");
  const details = summary.closest("details");
  expect(details?.open).toBe(false);
  await userEvent.setup().click(summary);
  expect(details?.open).toBe(true);
  expect(screen.getByText("$0.1234")).toBeTruthy();
  expect(screen.getByText("$0.02")).toBeTruthy();
  expect(screen.getByText("3 credits + pending")).toBeTruthy();
  expect(screen.getByText("126s")).toBeTruthy();
  expect(screen.getByText("12,000")).toBeTruthy();
  expect(screen.getByText("2,000")).toBeTruthy();
  expect(screen.getByText("1,500")).toBeTruthy();
  expect(screen.queryByText("Browser estimate")).toBeNull();
});

test("distinguishes a known zero estimate from missing provider usage", async () => {
  const cost = {
    modelPricingBasis: "standard_short_context_excluding_cache_writes",
    modelEstimateUsd: 0,
    webSearchUsd: 0,
    browserEstimateUsd: 0,
    browserSeconds: 0,
    reportedBrowserCredits: 0,
    unreportedBrowserSessions: 0,
    knownSubtotalUsd: 0,
    totalEstimateUsd: 0,
    missing: [],
  } satisfies Session["cost"];
  remote.queries.set("agentsApi/sessions:get", { ...session(), cost });
  await open("/agents?session=session-1");
  expect(await screen.findByText("Cost · $0.00 estimated")).toBeTruthy();
  updateQuery("agentsApi/sessions:get", {
    ...session(),
    usage: { inputTokens: 12_000, outputTokens: 1_500, cachedInputTokens: null },
    cost: {
      ...cost,
      modelEstimateUsd: null,
      totalEstimateUsd: null,
      missing: ["cached_input_usage"],
    },
  });
  expect(await screen.findByText("Cost pending")).toBeTruthy();
  await userEvent.setup().click(screen.getByText("Cost pending"));
  expect(screen.getByText("Unpriced")).toBeTruthy();
  expect(screen.getByText("Not reported")).toBeTruthy();
});

test("sums all checks once and marks incomplete check pricing as a subtotal", async () => {
  const cost = {
    ...session().cost,
    modelEstimateUsd: 0.1,
    knownSubtotalUsd: 0.1,
    totalEstimateUsd: 0.1,
    missing: [],
  } satisfies Session["cost"];
  const checks = [
    { _id: "initial", kind: "initial", status: "approved", cost: 0.01 },
    { _id: "resume-1", kind: "resume", status: "rejected", cost: 0.02 },
    { _id: "resume-2", kind: "resume", status: "approved", cost: 0.03 },
  ];
  remote.queries.set("agentsApi/sessions:get", { ...session(), cost, checks });
  await open("/agents?session=session-1");
  const summary = await screen.findByText("Cost · $0.16 estimated");
  await userEvent.setup().click(summary);
  expect(screen.getByText("Checks", { exact: true })).toBeTruthy();
  expect(screen.getByText("$0.06", { exact: true })).toBeTruthy();
  updateQuery("agentsApi/sessions:get", {
    ...session(),
    cost,
    checks: [...checks, { _id: "resume-3", kind: "resume", status: "failed", cost: null }],
  });
  expect(await screen.findByText("Cost · $0.16 subtotal")).toBeTruthy();
  expect(screen.getByText("$0.06 + unpriced")).toBeTruthy();
  updateQuery("agentsApi/sessions:get", {
    ...session(),
    checks: [{ _id: "initial", kind: "initial", status: "approved", cost: 0 }],
  });
  expect(await screen.findByText("Cost · $0.00 subtotal")).toBeTruthy();
});

test("refreshes an ended session without sending, preserves drafts on failure, and hides refresh while active", async () => {
  remote.queries.set("agentsApi/sessions:get", session({ kind: "stopped" }));
  remote.refresh.mockRejectedValueOnce(new Error("Could not read provider usage"));
  await open("/agents?session=session-1");
  const draft = await screen.findByLabelText<HTMLTextAreaElement>("Message");
  fireEvent.change(draft, { target: { value: "Keep this follow-up" } });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Refresh session" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not read provider usage");
  expect(draft.value).toBe("Keep this follow-up");
  expect(remote.refresh).toHaveBeenCalledWith({ sessionId: "session-1" });
  expect(remote.send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Refresh session" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(draft.value).toBe("Keep this follow-up");
  updateQuery("agentsApi/sessions:get", session({ kind: "running" }));
  expect(screen.queryByRole("button", { name: "Refresh session" })).toBeNull();
  expect(remote.refresh).toHaveBeenCalledTimes(2);
});

test("opens research as a flat session step and links its calls to private workspace files", async () => {
  const summary = { status: "completed", modelCost: 0.001, reportedCredits: 1 };
  const research = {
    _id: "research-1",
    _creationTime: 1000,
    sessionId: "session-1",
    site: "example.com",
    model: "gpt-5.6-luna",
    ...summary,
    state: {
      kind: "completed",
      finishedAt: 2000,
      brief: "A public calculator.",
      briefPath: "/workspace/research/brief.md",
    },
    calls: [
      {
        name: "brief",
        startedAt: 1000,
        finishedAt: 2000,
        requestPath: "/workspace/research/request.json",
        responsePath: "/workspace/research/response.json",
        usage: { inputTokens: 100, outputTokens: 10 },
        credits: null,
      },
    ],
  };
  remote.queries.set("agentsApi/sessions:get", { ...session(), research: summary });
  remote.queries.set("agentsApi/sessions:list", [{ ...session(), research: summary }]);
  remote.queries.set("agentsApi/siteResearchRecords:inspect", research);
  const router = await open("/agents?session=session-1&step=site_research");
  expect(await screen.findByRole("heading", { name: "Site research" })).toBeTruthy();
  expect(screen.getByText("A public calculator.")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Site research/ }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBeNull();
  expect(screen.queryByRole("region", { name: "Conversation" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("link", { name: "Request" }));
  expect(router.state.location.search).toMatchObject({
    session: "session-1",
    step: "chat",
    view: "workspace",
    file: "/workspace/research/request.json",
  });
});

test("shows research during startup and allows stopping before the chat exists", async () => {
  const summary = { status: "running", modelCost: null, reportedCredits: 0 };
  remote.queries.set("agentsApi/sessions:get", {
    ...session({ kind: "starting" }),
    providerId: undefined,
    research: summary,
  });
  remote.queries.set("agentsApi/siteResearchRecords:inspect", {
    _id: "research-1",
    _creationTime: 1000,
    sessionId: "session-1",
    site: "example.com",
    model: "gpt-5.6-luna",
    ...summary,
    state: { kind: "running" },
    calls: [],
  });
  await open("/agents?session=session-1");
  expect(await screen.findByText("Gathering site information…")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Stop" }));
  expect(remote.stop).toHaveBeenCalledWith({ sessionId: "session-1" });
});
