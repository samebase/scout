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
import { agentsSearch, type BrowserSession, type Session } from "./model";

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
    const value = remote.queries.get(name);
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
    model: "gpt-5.6-luna",
    providerId: "provider-1",
    browser: null,
    usage: null,
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
    { _id: "scout-1", displayName: "Pip", status: "active" },
    { _id: "scout-2", displayName: "Moss", status: "active" },
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
  await waitFor(() => expect(remote.resume).toHaveBeenCalledWith({ sessionId: "session-1" }));
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
