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
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Route as TaskRoute } from "../../routes/tasks.$thread";
import { Route as PlayRoute } from "../../routes/play";
import { Route as SiteRoute } from "../../routes/sites.$site";
import { Route as HomeRoute } from "../../routes/index";
import { homeSearch } from "../../lib/homeSearch";
import { api } from "../../../convex/_generated/api";
import { ROLE_ACCESS_GRANTS } from "../../../shared/accessModel";
import { omitNullish } from "../../../shared/omitNullish";
import { HANDOFF_EXPIRED_REASON, handoffDeadlineMessage } from "../../../shared/handoff";

const remote = vi.hoisted(() => ({
  authenticated: true,
  messages: Array<FunctionReturnType<typeof api.scout.activity.messages>["page"][number]>(),
  messageStatus: "Exhausted",
  loadEarlierMessages: vi.fn(),
  revision: 0,
  subscribers: new Set<() => void>(),
  queries: new Map<string, unknown>(),
  createThread: vi.fn(),
  sendManaged: vi.fn(),
  retryManaged: vi.fn(),
  stopManaged: vi.fn(),
  resumeManaged: vi.fn(),
  setVisibility: vi.fn(),
  savePreferences: vi.fn(),
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
    if (getFunctionName(reference) === "tasks/screenshots:imageUrl") return remote.screenshotUrl;
    if (getFunctionName(reference) === "browserReplay:listPages") return remote.listReplayPages;
    throw new Error("Unexpected action");
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    remote.queryCalls(getFunctionName(reference), args);
    if (getFunctionName(reference) === "scout/activity:messages")
      return {
        results: remote.messages,
        status: remote.messageStatus,
        loadMore: remote.loadEarlierMessages,
      };
    return remote.queries.get(getFunctionName(reference));
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    switch (getFunctionName(reference)) {
      case "accounts:setTaskPreferences":
        return Object.assign(remote.savePreferences, {
          withOptimisticUpdate: () => remote.savePreferences,
        });
      case "scout/chats:startProductChat":
        return remote.createThread;
      case "scout/chats:setVisibility":
        return remote.setVisibility;
      case "tasks/sessions:send":
        return remote.sendManaged;
      case "tasks/sessions:retryMessage":
        return remote.retryManaged;
      case "tasks/sessions:stop":
        return remote.stopManaged;
      case "tasks/sessions:resume":
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
    runtime: { kind: "task", sessionId: "managed-1" },
    latestSession: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
  remote.messages = [];
  remote.messageStatus = "Exhausted";
  remote.loadEarlierMessages.mockReset();
  remote.authenticated = true;
  remote.queryCalls.mockClear();
  remote.screenshotUrl.mockReset().mockResolvedValue(null);
  remote.revision = 0;
  remote.queries.clear();
  remote.queries.set("accounts:taskPreferences", {});
  remote.savePreferences.mockReset().mockImplementation(async (patch) => {
    const current = remote.queries.get("accounts:taskPreferences");
    remote.queries.set("accounts:taskPreferences", {
      ...(current && typeof current === "object" ? current : {}),
      ...patch,
    });
    remote.revision += 1;
    remote.subscribers.forEach((notify) => notify());
    return null;
  });
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
  for (const query of ["scout/sites:list", "scout/activity:unassigned"]) {
    remote.queries.set(query, { results: [], status: "Exhausted", loadMore: vi.fn() });
  }
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "idle" },
    pendingMessage: null,
    active: false,
    canRetryMessage: false,
    resumeAttempts: [],
    canSend: true,
    canStop: false,
    busy: false,
  });
  remote.createThread.mockReset().mockResolvedValue({ threadId: "game-thread" });
  remote.sendManaged.mockReset().mockResolvedValue(null);
  remote.retryManaged.mockReset().mockResolvedValue(null);
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
    path: "/tasks/$thread",
    staticData: { access: "access_public" },
    ...omitNullish({
      component: TaskRoute.options.component,
      validateSearch: TaskRoute.options.validateSearch,
    }),
  });
  const directory = createRoute({
    getParentRoute: () => root,
    path: "/",
    staticData: { access: "access_public" },
    ...omitNullish({
      component: HomeRoute.options.component,
      validateSearch: HomeRoute.options.validateSearch,
    }),
  });
  const site = createRoute({
    getParentRoute: () => root,
    path: "/sites/$site",
    staticData: { access: "access_public" },
    ...omitNullish({ validateSearch: SiteRoute.options.validateSearch }),
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    staticData: { access: "access_account" },
    component: () => <h1>Credit settings</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([route, review, directory, site, settings]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("a site link opens the shared composer without submitting and sends the selected site", async () => {
  const router = await openPlay("/?taskSite=EXAMPLE.COM&scope=mine&site=another");
  const input = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" });
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("What should Scout do on this site?");
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole("button", { name: "Remove example.com from task" })).toBeTruthy();
  expect(remote.createThread).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
    true,
  );
  expect(remote.queryCalls).toHaveBeenCalledWith("scout/sites:list", {
    scope: "mine",
    site: "another",
  });

  fireEvent.change(input, { target: { value: "Check the sign-up flow." } });
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Your Scout" }));
  await user.click(screen.getByRole("option", { name: "Moss" }));
  await user.click(screen.getByRole("combobox", { name: "Visibility" }));
  await user.click(screen.getByRole("option", { name: "Private" }));
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/tasks/game-thread"));
  expect(router.state.location.search).toEqual({});
  expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({
    product: { kind: "review", site: "example.com" },
    scoutId: "scout-2",
    prompt: "Check the sign-up flow.",
    visibility: "private",
    engine: "agents_api",
  });
  act(() => router.history.back());
  expect(await screen.findByRole("button", { name: "Remove example.com from task" })).toBeTruthy();
  expect(remote.createThread).toHaveBeenCalledTimes(1);
});

test("the composer restores saved choices and saves picker changes before any task starts", async () => {
  remote.queries.set("accounts:taskPreferences", {
    lastScoutId: "scout-2",
    lastTaskEngine: "convex_agent",
  });
  await openPlay();
  expect(screen.getByRole("combobox", { name: "Your Scout" }).textContent).toContain("Moss");
  expect(screen.getByRole("combobox", { name: "Task engine" }).textContent).toContain(
    "Luna - Convex",
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Task engine" }));
  await user.click(screen.getByRole("option", { name: "Luna - Agents API" }));
  await user.click(screen.getByRole("combobox", { name: "Your Scout" }));
  await user.click(screen.getByRole("option", { name: "Pip" }));
  expect(remote.savePreferences.mock.calls).toEqual([
    [{ lastTaskEngine: "agents_api" }],
    [{ lastScoutId: "scout-1" }],
  ]);
  expect(remote.createThread).not.toHaveBeenCalled();
  cleanup();
  await openPlay();
  expect(screen.getByRole("combobox", { name: "Your Scout" }).textContent).toContain("Pip");
  expect(screen.getByRole("combobox", { name: "Task engine" }).textContent).toContain(
    "Luna - Agents API",
  );
});

test("site selection survives feed filters and removal keeps the draft without adding history", async () => {
  const router = await openPlay("/?taskSite=example.com");
  const input = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" });
  fireEvent.change(input, { target: { value: "Check the sign-up flow." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Filter by site" }), {
    target: { value: "another" },
  });
  await waitFor(() =>
    expect(router.state.location.search).toEqual({
      taskSite: "example.com",
      site: "another",
      scope: "public",
    }),
  );
  expect(screen.getByRole("textbox", { name: "Message Scout" })).toBe(input);
  const historyLength = router.history.length;
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Remove example.com from task" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ site: "another", scope: "public" }),
  );
  expect(router.history.length).toBe(historyLength);
  expect(input.value).toBe("Check the sign-up flow.");
  expect(input.placeholder).toBe("Paste a product link and describe what to review.");
  await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(remote.createThread).toHaveBeenCalledExactlyOnceWith({
      product: { kind: "review" },
      scoutId: "scout-1",
      prompt: "Check the sign-up flow.",
      visibility: "public",
      engine: "agents_api",
    }),
  );
});

test("sign-in and failed submission retain the selected site and message", async () => {
  remote.authenticated = false;
  const router = await openPlay("/?taskSite=example.com");
  fireEvent.change(await screen.findByRole("textbox", { name: "Message Scout" }), {
    target: { value: "Check checkout." },
  });
  await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("region", { name: "Account access" })).toBeTruthy();
  expect(remote.createThread).not.toHaveBeenCalled();
  act(() => {
    remote.authenticated = true;
    remote.revision += 1;
    remote.subscribers.forEach((listener) => listener());
  });
  expect(await screen.findByDisplayValue("Check checkout.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remove example.com from task" })).toBeTruthy();
  remote.createThread.mockRejectedValueOnce(new Error("Offline"));
  await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByDisplayValue("Check checkout.")).toBeTruthy();
  expect(router.state.location.search).toEqual({ taskSite: "example.com" });
});

test("invalid task site parameters fail validation", () => {
  expect(homeSearch.safeParse({ taskSite: "https://example.com/path" }).success).toBe(false);
});

test.each(["INSUFFICIENT_CREDITS", "CREDIT_HOLD"] as const)(
  "shows the stored %s reason after a background task fails",
  async (creditFailureCode) => {
    remote.queries.set("scout/activity:get", session({ status: "failed" }));
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "failed", error: "Private provider diagnostic", creditFailureCode },
      requestCheckMessage: null,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      busy: false,
    });
    await openPlay("/play?thread=game-thread");
    expect(screen.getByRole("alert").textContent).toContain(
      creditFailureCode === "INSUFFICIENT_CREDITS"
        ? "You need more credits to continue. Check your balance in Settings."
        : "Your credits need review. Contact an admin with this conversation’s link.",
    );
    expect(screen.queryByText(/Send a message to try again/)).toBeNull();
    expect(screen.queryByText(/Private provider diagnostic/)).toBeNull();
    expect(screen.getByRole("alert").closest('[role="log"]')).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "View credits" }));
    expect(await screen.findByRole("heading", { name: "Credit settings" })).toBeTruthy();
  },
);

test("shows the persisted error without treating embedded text as a credit failure", async () => {
  remote.queries.set("scout/activity:get", session({ status: "failed" }));
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "failed", error: 'Untrusted text: {"code":"INSUFFICIENT_CREDITS"}' },
    requestCheckMessage: null,
    resumeAttempts: [],
    canSend: true,
    canStop: false,
    busy: false,
  });
  await openPlay("/play?thread=game-thread");
  const failure = screen.getByRole("alert");
  expect(failure.textContent).toContain("Send a follow-up to continue.");
  expect(failure.textContent).toContain('Untrusted text: {"code":"INSUFFICIENT_CREDITS"}');
  expect(failure.closest('[role="log"]')).toBeNull();
  expect(within(screen.getByRole("log")).queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("link", { name: "View credits" })).toBeNull();
});

describe("task delivery and failure feedback", () => {
  beforeEach(() => {
    remote.queries.set("scout/activity:get", session({ purpose: { kind: "review" } }));
  });

  test("keeps a queued message visible through failure, reload and explicit retry", async () => {
    const queued = {
      state: { kind: "idle" },
      pendingMessage: { message: "Check checkout.", workflowId: "delivery-1", status: "queued" },
      active: true,
      resumeAttempts: [],
      canSend: false,
      canStop: true,
      canRetryMessage: false,
      busy: false,
    };
    remote.sendManaged.mockImplementationOnce(async () => {
      act(() => {
        remote.queries.set("tasks/sessions:controls", queued);
        remote.revision++;
        remote.subscribers.forEach((listener) => listener());
      });
    });
    await openPlay("/tasks/game-thread");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
      target: { value: "Check checkout." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const pendingMessage = await screen.findByRole("group", { name: "Pending message" });
    expect(within(pendingMessage).getByText("Check checkout.")).toBeTruthy();
    expect(within(pendingMessage).getByRole("status").textContent).toBe("Sending…");
    expect(pendingMessage.closest('[role="log"]')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message Scout" })).toHaveProperty("value", ""),
    );
    const failed = {
      ...queued,
      state: { kind: "failed", error: "Private workflow error" },
      active: false,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      canRetryMessage: true,
    };
    act(() => {
      remote.queries.set("tasks/sessions:controls", failed);
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(within(pendingMessage).getByRole("alert").textContent).toBe("Your message wasn’t sent.");
    expect(screen.queryByText("Send a follow-up to continue.")).toBeNull();
    cleanup();
    await openPlay("/tasks/game-thread");
    expect(
      within(screen.getByRole("group", { name: "Pending message" })).getByText("Check checkout."),
    ).toBeTruthy();
    expect(remote.retryManaged).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
      target: { value: "A separate draft" },
    });
    expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() =>
      expect(remote.retryManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
    );
    expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
      sessionId: "managed-1",
      message: "Check checkout.",
    });
    expect(screen.getByDisplayValue("A separate draft")).toBeTruthy();
    act(() => {
      remote.queries.set("tasks/sessions:controls", queued);
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
    expect(screen.getByText("Sending…")).toBeTruthy();
    act(() => {
      remote.queries.set("tasks/sessions:controls", { ...queued, pendingMessage: null });
      remote.messages = [
        { kind: "message", id: "accepted-1", role: "user", text: "Check checkout." },
      ];
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("group", { name: "Pending message" })).toBeNull();
    expect(screen.getAllByText("Check checkout.")).toHaveLength(1);
    expect(screen.getByDisplayValue("A separate draft")).toBeTruthy();
  });

  test.each(["queued", "submitting"])(
    "%s delivery survives reload and permits an explicit new follow-up",
    async (status) => {
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "failed", error: "Private delivery error" },
        pendingMessage: {
          message: "Original request",
          workflowId: "delivery-1",
          status,
        },
        active: false,
        resumeAttempts: [],
        canSend: true,
        canStop: false,
        canRetryMessage: status === "queued",
        busy: false,
      });
      for (let visit = 0; visit < 2; visit++) {
        if (visit > 0) cleanup();
        await openPlay("/tasks/game-thread");
        const pendingMessage = screen.getByRole("group", { name: "Pending message" });
        expect(within(pendingMessage).getByText("Original request")).toBeTruthy();
        expect(within(pendingMessage).getByRole("alert").textContent).toBe(
          status === "queued"
            ? "Your message wasn’t sent."
            : "We couldn’t confirm whether your message was delivered. Check the conversation before sending it again.",
        );
        expect(screen.queryByRole("button", { name: "Retry message" }) !== null).toBe(
          status === "queued",
        );
        expect(remote.sendManaged).not.toHaveBeenCalled();
        expect(remote.retryManaged).not.toHaveBeenCalled();
      }
      fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
        target: { value: "Please continue from the last confirmed step." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() =>
        expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
          sessionId: "managed-1",
          message: "Please continue from the last confirmed step.",
        }),
      );
      expect(remote.retryManaged).not.toHaveBeenCalled();
    },
  );

  test.each(["queued", "submitting"])(
    "keeps active %s delivery visible while stopping",
    async (status) => {
      const controls = {
        state: { kind: "idle" },
        pendingMessage: { message: "Pending text", workflowId: "delivery-1", status },
        active: true,
        resumeAttempts: [],
        canSend: false,
        canStop: true,
        canRetryMessage: false,
        busy: false,
      };
      remote.queries.set("tasks/sessions:controls", controls);
      await openPlay("/tasks/game-thread");
      expect(screen.getByText("Sending…")).toBeTruthy();
      fireEvent.click(screen.getAllByRole("button", { name: "Stop Scout" })[0]);
      await waitFor(() =>
        expect(remote.stopManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
      );
      act(() => {
        remote.queries.set("tasks/sessions:controls", { ...controls, state: { kind: "stopped" } });
        remote.revision++;
        remote.subscribers.forEach((listener) => listener());
      });
      expect(screen.queryByText("Sending…")).toBeNull();
      expect(screen.getByText("Pending text")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
    },
  );

  test.each([
    { active: true, busy: false },
    { active: false, busy: true },
  ])(
    "keeps failed delivery visible but cannot retry during cleanup or while busy: %j",
    async ({ active, busy }) => {
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "failed", error: "Private error" },
        pendingMessage: { message: "Pending text", workflowId: "delivery-1", status: "queued" },
        active,
        resumeAttempts: [],
        canSend: false,
        canStop: active,
        canRetryMessage: false,
        busy,
      });
      await openPlay("/tasks/game-thread");
      expect(screen.queryByText("Sending…")).toBeNull();
      expect(screen.getByText("Your message wasn’t sent.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
      expect(remote.retryManaged).not.toHaveBeenCalled();
      if (busy) expect(screen.getByText("This Scout is busy in another chat.")).toBeTruthy();
    },
  );

  test("a rejected send keeps the draft and shows the error beside the composer", async () => {
    remote.sendManaged.mockRejectedValueOnce(new Error("Private send failure"));
    await openPlay("/tasks/game-thread");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
      target: { value: "Keep my original message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Your message wasn't sent. Try again when Scout is ready.");
    expect(error.closest('[role="log"]')).toBeNull();
    expect(screen.getByDisplayValue("Keep my original message")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Pending message" })).toBeNull();
    expect(screen.queryByText("Private send failure")).toBeNull();
  });

  test.each(["chat", "walkthrough"])(
    "an accepted API failure shows its actual message in %s with diagnostic details and a normal follow-up",
    async (view) => {
      const apiMessage = "500 upstream request failed: browser tool exceeded the service timeout.";
      remote.queries.set(
        "scout/activity:get",
        session({ status: "failed", purpose: { kind: "review" } }),
      );
      remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
      remote.queries.set("tasks/sessions:controls", {
        state: {
          kind: "failed",
          error: "Error: provider request failed\n    at advance (runtime.ts:20:1)",
          diagnostic: {
            category: "transient_service",
            operation: "advance",
            occurredAtMs: 1000,
            provider: "openai",
            message: apiMessage,
            httpStatus: 500,
            providerCode: "server_error",
            requestId: "req-api-error",
          },
        },
        pendingMessage: null,
        active: false,
        canRetryMessage: false,
        resumeAttempts: [],
        canSend: true,
        canStop: false,
        busy: false,
      });
      await openPlay(`/tasks/game-thread?view=${view}`);
      const failure = screen.getByRole("alert");
      const message = within(failure).getByText(apiMessage);
      expect(message.closest("details")).toBeNull();
      expect(screen.queryByText(/AI service is temporarily unavailable/)).toBeNull();
      expect(failure.textContent).toContain("Send a follow-up to continue.");
      expect(failure.closest('[role="log"]')).toBeNull();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.queryByText("Scout couldn't finish this turn.")).toBeNull();
      const details = within(failure).getByText("Details").closest("details");
      expect(details?.open).toBe(false);
      await userEvent.setup().click(within(failure).getByText("Details"));
      expect(details?.open).toBe(true);
      const diagnostic = details?.querySelector("pre")?.textContent;
      expect(diagnostic).toContain('"httpStatus": 500');
      expect(diagnostic).toContain('"providerCode": "server_error"');
      expect(diagnostic).toContain('"requestId": "req-api-error"');
      expect(diagnostic).toContain('"operation": "advance"');
      expect(diagnostic).toContain("runtime.ts:20:1");
      expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
      if (view === "walkthrough") {
        fireEvent.click(screen.getByRole("link", { name: "Send a follow-up to continue." }));
      }
      const input = await screen.findByRole("textbox", { name: "Message Scout" });
      fireEvent.change(input, { target: { value: "Continue from the last step." } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() =>
        expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
          sessionId: "managed-1",
          message: "Continue from the last step.",
        }),
      );
    },
  );

  test.each([
    undefined,
    {
      category: "transient_service",
      operation: "advance",
      occurredAtMs: 1000,
      provider: "openai",
      httpStatus: 502,
    },
  ])(
    "older failures show the persisted error with the stack in Details: %j",
    async (diagnostic) => {
      const error = "Error: 502 Bad gateway\n    at advance (runtime.ts:20:1)";
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "failed", error, ...omitNullish({ diagnostic }) },
        pendingMessage: null,
        active: false,
        resumeAttempts: [],
        canSend: true,
        canStop: false,
        canRetryMessage: false,
        busy: false,
      });
      await openPlay("/tasks/game-thread");
      const failure = screen.getByRole("alert");
      expect(within(failure).getByText("Error: 502 Bad gateway").closest("details")).toBeNull();
      expect(failure.closest('[role="log"]')).toBeNull();
      const details = within(failure).getByText("Details").closest("details");
      expect(details?.open).toBe(false);
      expect(details?.querySelector("pre")?.textContent).toContain("runtime.ts:20:1");
      expect(screen.queryByText(/AI service is temporarily unavailable/)).toBeNull();
    },
  );

  test.each([null, { message: "Initial task", workflowId: "delivery-1", status: "queued" }])(
    "an initial failure without a provider offers a new task instead of a follow-up: %j",
    async (pendingMessage) => {
      remote.queries.set(
        "scout/activity:get",
        session({ status: "failed", purpose: { kind: "review" } }),
      );
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "failed", error: "Private startup failure" },
        pendingMessage,
        active: false,
        resumeAttempts: [],
        canSend: false,
        canStop: false,
        canRetryMessage: false,
        busy: false,
      });
      await openPlay("/tasks/game-thread");
      expect(screen.queryByText("Send a follow-up to continue.")).toBeNull();
      expect(screen.getByRole("link", { name: "Start a new task" }).getAttribute("href")).toBe("/");
      expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true);
    },
  );

  test("pending message and retry stay visible in Walkthrough", async () => {
    remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "stopped" },
      pendingMessage: {
        message: "Check the final page",
        workflowId: "delivery-1",
        status: "queued",
      },
      active: false,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      canRetryMessage: true,
      busy: false,
    });
    await openPlay("/tasks/game-thread?view=walkthrough");
    expect(screen.getByRole("region", { name: "Walkthrough with Scout" })).toBeTruthy();
    expect(screen.getByText("Check the final page")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() =>
      expect(remote.retryManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
    );
    expect(remote.sendManaged).not.toHaveBeenCalled();
  });

  test("a failed request check keeps its specific message above the composer", async () => {
    remote.queries.set(
      "scout/activity:get",
      session({ status: "failed", purpose: { kind: "review" } }),
    );
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "failed", error: "Private check diagnostic" },
      requestCheckMessage: "Could not capture browser evidence.",
      pendingMessage: null,
      active: false,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      canRetryMessage: false,
      busy: false,
    });
    await openPlay("/tasks/game-thread");
    const failure = screen.getByRole("alert");
    expect(failure.textContent).toBe("Could not capture browser evidence.");
    expect(failure.closest('[role="log"]')).toBeNull();
  });

  test("public viewers see generic failure without owner delivery details", async () => {
    remote.queries.set("tasks/sessions:controls", {
      state: {
        kind: "failed",
        error: "Owner-only persisted error",
        diagnostic: {
          category: "configuration",
          operation: "advance",
          occurredAtMs: 1000,
          provider: "openai",
          message: "Owner-only API message",
          requestId: "owner-only-request-id",
        },
      },
      pendingMessage: null,
      active: false,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      canRetryMessage: false,
      busy: false,
    });
    remote.queries.set(
      "scout/activity:get",
      session({
        status: "failed",
        purpose: { kind: "review" },
        visibility: "public",
        canControl: false,
        isOwner: false,
      }),
    );
    await openPlay("/tasks/game-thread");
    expect(screen.getByRole("alert").textContent).toBe("Scout couldn't finish this turn.");
    expect(screen.queryByRole("group", { name: "Pending message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
    expect(screen.queryByText("Send a follow-up to continue.")).toBeNull();
    expect(document.body.textContent).not.toContain("Owner-only");
    expect(document.body.textContent).not.toContain("owner-only-request-id");
    expect(screen.queryByText("Details")).toBeNull();
    expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:controls", "skip");
  });

  test("failed retry retains the persisted message and a separate draft", async () => {
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "stopped" },
      pendingMessage: { message: "Original request", workflowId: "delivery-1", status: "queued" },
      active: false,
      resumeAttempts: [],
      canSend: true,
      canStop: false,
      canRetryMessage: true,
      busy: false,
    });
    remote.retryManaged.mockRejectedValueOnce(new Error("Private retry error"));
    await openPlay("/tasks/game-thread");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
      target: { value: "A separate draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    expect(await screen.findByText("Couldn't retry your message. Try again.")).toBeTruthy();
    expect(screen.getByText("Original request")).toBeTruthy();
    expect(screen.getByDisplayValue("A separate draft")).toBeTruthy();
    expect(remote.retryManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" });
    expect(remote.sendManaged).not.toHaveBeenCalled();
  });
});

test("sends when controls allow it without credit settlement messages", async () => {
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "idle" },
    resumeAttempts: [],
    canSend: true,
    canStop: false,
    busy: false,
  });
  await openPlay("/play?thread=game-thread");
  expect(screen.queryByText(/Finishing this turn’s credit usage/)).toBeNull();
  expect(screen.queryByText(/This turn’s credit usage needs review/)).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Scout" }), {
    target: { value: "Continue the game" },
  });
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(remote.sendManaged).toHaveBeenCalledWith({
      sessionId: "managed-1",
      message: "Continue the game",
    }),
  );
});

test("a completed managed Review opens its walkthrough and pairs replay with Chat", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "task", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("tasks/walkthrough:get", {
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
  const router = await openPlay("/tasks/game-thread");
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
    runtime: { kind: "task", sessionId: "managed-1" },
  });
  remote.queries.set("scout/activity:get", running);
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "running" },
    canStop: true,
    resumeAttempts: [],
    canSend: false,
  });
  remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/tasks/game-thread");
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
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "idle" },
      canStop: false,
      resumeAttempts: [],
      canSend: true,
    });
    remote.queries.set("tasks/walkthrough:get", {
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
  fireEvent.click(screen.getByRole("link", { name: "Chat & replay" }));
  expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  expect(screen.getByDisplayValue("Keep this thought")).toBeTruthy();
  expect(remote.sendManaged).not.toHaveBeenCalled();
});

test.each(["finished", "failed", "running", "stopped"])(
  "a %s Review keeps its composer in Chat and preserves the draft across Walkthrough",
  async (status) => {
    remote.queries.set(
      "scout/activity:get",
      session({
        purpose: { kind: "review" },
        status,
        hasWalkthrough: true,
        runtime: { kind: "task", sessionId: "managed-1" },
      }),
    );
    remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
    const router = await openPlay("/tasks/game-thread?view=chat");
    fireEvent.change(await screen.findByRole("textbox", { name: "Message Scout" }), {
      target: { value: "Keep this follow-up" },
    });

    fireEvent.click(screen.getByRole("link", { name: "Walkthrough" }));
    await screen.findByRole("region", { name: "Walkthrough with Scout" });
    expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Chat & replay" }));
    await screen.findByRole("region", { name: "Conversation with Scout" });
    expect(router.state.location.search.view).toBe("chat");
    expect(screen.getByDisplayValue("Keep this follow-up")).toBeTruthy();
    expect(remote.sendManaged).not.toHaveBeenCalled();
  },
);

test("a direct walkthrough link shows an older task's empty state without forcing a report", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: false,
      runtime: { kind: "task", sessionId: "managed-1" },
    }),
  );
  remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/tasks/game-thread?view=walkthrough");
  expect(await screen.findByRole("heading", { name: "No screenshots saved" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Chat & replay" })).toBeTruthy();
  expect(remote.sendManaged).not.toHaveBeenCalled();
});

test("a finished review keeps costs and usage visible across Walkthrough and Chat", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({ purpose: { kind: "review" }, status: "finished", hasWalkthrough: true }),
  );
  const costs: FunctionReturnType<typeof api.tasks.sessions.cost> = {
    cost: {
      modelPricingBasis: "provider_reported",
      modelEstimateUsd: 0.25,
      webSearchUsd: 0,
      browserEstimateUsd: null,
      browserSeconds: 60,
      reportedBrowserCredits: 2,
      unreportedBrowserSessions: 0,
      knownSubtotalUsd: 0.25,
      totalEstimateUsd: null,
      missing: ["firecrawl_credit_price"],
    },
    usage: { inputTokens: 1200, cachedInputTokens: 200, outputTokens: 300 },
    checks: [],
    research: null,
  };
  remote.queries.set("tasks/sessions:cost", costs);
  remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/tasks/game-thread");
  await screen.findByRole("region", { name: "Walkthrough with Scout" });
  const cost = screen.getByText("Cost · $0.25 subtotal");
  await userEvent.setup().click(cost);
  expect(cost.closest("details")?.open).toBe(true);
  expect(screen.getByText("Input tokens").nextElementSibling?.textContent).toBe("1,200");
  expect(screen.getByText("Firecrawl").nextElementSibling?.textContent).toBe("2 credits");
  expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:cost", {
    sessionId: "managed-1",
  });
  await userEvent.setup().click(screen.getByRole("link", { name: "Chat & replay" }));
  expect(await screen.findByRole("textbox", { name: "Message Scout" })).toBeTruthy();
  expect(screen.getByText("Cost · $0.25 subtotal")).toBe(cost);
  expect(cost.closest("details")?.open).toBe(true);
  expect(screen.queryByRole("link", { name: "Review with Scout" })).toBeNull();
});

test.each([
  {
    isOwner: false,
    reason: "Only the account that started this chat can send follow-up messages.",
  },
  {
    isOwner: true,
    reason: "Your account doesn't currently have access to continue this chat.",
  },
])("read-only reviews explain access for isOwner=$isOwner", async ({ isOwner, reason }) => {
  remote.queries.set(
    "scout/activity:get",
    session({ purpose: { kind: "review" }, status: "finished", isOwner, canControl: false }),
  );
  await openPlay("/tasks/game-thread");
  expect(await screen.findByText(reason)).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Review with Scout" })).toBeNull();
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:cost", "skip");
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:controls", "skip");
});

test("desktop Chat always shows its replay and Walkthrough occupies the full layout", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "task", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
  await openPlay("/tasks/game-thread");
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

test("mobile Review keeps replay in the right sidebar without pane toggles", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      status: "finished",
      hasWalkthrough: true,
      runtime: { kind: "task", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
      isOwner: false,
      canControl: false,
    }),
  );
  remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
  const router = await openPlay("/tasks/game-thread");
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
    if (view === "chat") {
      const chat = screen.getByRole("region", { name: "Conversation with Scout" });
      const browser = screen.getByRole("region", { name: "Scout's browser" });
      expect(chat.closest("[data-pane-side]")?.getAttribute("data-pane-side")).toBe("main");
      expect(browser.closest("[data-pane-side]")?.getAttribute("data-pane-side")).toBe("right");
    }
    expect(
      screen.queryByRole("button", { name: /Show replay|Hide replay|Back to chat/ }),
    ).toBeNull();
  }
});

test("resizing Review keeps its title, pane controls, chat draft, and replay mounted", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      title: "Review Pika",
      primarySite: "pika.style",
      status: "finished",
      runtime: { kind: "task", sessionId: "managed-1" },
      sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "closed", createdAt: 1000 }],
    }),
  );
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "idle" },
    resumeAttempts: [],
    canSend: true,
    canStop: false,
  });
  await openPlay("/tasks/game-thread?view=chat");
  const chat = await screen.findByRole("region", { name: "Conversation with Scout" });
  const browser = screen.getByRole("region", { name: "Scout's browser" });
  const composer = screen.getByRole("textbox", { name: "Message Scout" });
  const heading = screen.getByRole("heading", { name: "Review Pika" });
  const views = screen.getByRole("navigation", { name: "Review views" });
  const visibility = screen.getByRole("combobox", { name: "Chat visibility" });
  const header = heading.closest('[data-sidebar-layout-part="address-chrome"]');
  expect(header).not.toBeNull();
  expect(views.closest("[data-pane-side]")?.getAttribute("data-pane-side")).toBe("main");
  expect(visibility.closest("[data-pane-side]")?.getAttribute("data-pane-side")).toBe("main");
  expect(
    screen
      .getByRole("link", { name: "Open in Agents" })
      .closest('[data-sidebar-layout-part="address-chrome"]'),
  ).toBe(header);
  expect(
    screen
      .getByRole("button", { name: "Show tasks" })
      .closest('[data-sidebar-layout-part="address-chrome"]'),
  ).toBe(header);
  expect(
    screen
      .getByRole("link", { name: "pika.style tasks" })
      .closest("[data-pane-side]")
      ?.getAttribute("data-pane-side"),
  ).toBe("left");
  expect(heading.closest("[data-pane-side]")).toBeNull();
  fireEvent.change(composer, { target: { value: "Keep this draft" } });
  await waitFor(() => expect(remote.listReplayPages).toHaveBeenCalledTimes(1));

  for (const width of [1440, 771, 767, 390]) {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("region", { name: "Conversation with Scout" })).toBe(chat);
    expect(screen.getByRole("region", { name: "Scout's browser" })).toBe(browser);
    expect(screen.getByRole("heading", { name: "Review Pika" })).toBe(heading);
    expect(screen.getByRole("navigation", { name: "Review views" })).toBe(views);
    expect(screen.getByRole("combobox", { name: "Chat visibility" })).toBe(visibility);
    expect(browser.closest("[data-pane-side]")?.getAttribute("data-pane-side")).toBe("right");
    expect(screen.getByDisplayValue("Keep this draft")).toBe(composer);
    expect(remote.listReplayPages).toHaveBeenCalledTimes(1);
  }
});

test("admins can open another member's Review in the Agents inspector", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      runtime: { kind: "task", sessionId: "managed-1" },
      isOwner: false,
      canControl: false,
      visibility: "public",
    }),
  );
  await openPlay("/tasks/game-thread");
  expect((await screen.findByRole("link", { name: "Open in Agents" })).getAttribute("href")).toBe(
    "/agents?session=managed-1",
  );
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:controls", "skip");
});

test("legacy threads without shared task IDs do not offer an Agents inspector link", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({ purpose: { kind: "review" }, runtime: { kind: "convex_agent" }, canControl: false }),
  );
  await openPlay("/tasks/game-thread");
  await screen.findByRole("region", { name: "Conversation with Scout" });
  expect(screen.queryByRole("link", { name: "Open in Agents" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Chat visibility" })).toBeNull();
  expect(
    screen.getByText(
      "This older chat is read-only. Its transcript and replay are still available.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Review with Scout" })).toBeNull();
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:controls", "skip");
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:cost", "skip");
});

test("legacy Convex sessions keep transcript and replay without mounting execution controls", async () => {
  remote.queries.set(
    "scout/activity:get",
    session({
      runtime: { kind: "convex_agent" },
      canControl: false,
      sessions: [
        { engine: "convex_agent", sessionId: "legacy-browser", kind: "closed", createdAt: 1000 },
      ],
    }),
  );
  remote.messages = [
    { kind: "message", id: "legacy-message", role: "assistant", text: "Saved legacy transcript." },
  ];
  await openPlay("/play?thread=game-thread");
  expect(await screen.findByText("Saved legacy transcript.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show Scout’s view" }));
  await waitFor(() =>
    expect(remote.listReplayPages).toHaveBeenCalledWith({ sessionId: "legacy-browser" }),
  );
  expect(screen.queryByRole("textbox", { name: "Message Scout" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Open in Agents" })).toBeNull();
  expect(remote.queryCalls).not.toHaveBeenCalledWith(
    "scout/chats:getScoutActivity",
    expect.anything(),
  );
  expect(remote.queryCalls).not.toHaveBeenCalledWith("humanHandoffs:forSession", expect.anything());
});

test("shows the local Resume deadline and the specific reason after expiration", async () => {
  const expiresAt = Date.parse("2026-09-19T12:45:00Z");
  remote.queries.set(
    "scout/activity:get",
    session({ purpose: { kind: "review" }, status: "waiting" }),
  );
  const controls = {
    state: {
      kind: "waiting",
      message: "Complete verification",
      callId: "call",
      turnId: "turn",
      expiresAt,
    },
    resumeAttempts: [],
    canSend: false,
    canStop: true,
    active: true,
    interactiveLiveViewUrl: null,
  };
  remote.queries.set("tasks/sessions:controls", controls);
  await openPlay("/tasks/game-thread");
  expect(await screen.findByText(handoffDeadlineMessage(expiresAt, undefined))).toBeTruthy();
  act(() => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, status: "stopped" }),
    );
    remote.queries.set("tasks/sessions:controls", {
      ...controls,
      state: { kind: "stopped", reason: "handoff_expired" },
      active: false,
    });
    remote.revision++;
    remote.subscribers.forEach((listener) => listener());
  });
  expect(await screen.findByText(HANDOFF_EXPIRED_REASON)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
});

test("Review uses managed controls and keeps live view, handoff and follow-up messages on the same page", async () => {
  const review = session({
    purpose: { kind: "review" },
    runtime: { kind: "task", sessionId: "managed-1" },
    status: "waiting",
    sessions: [{ engine: "agents_api", sessionId: "browser-1", kind: "active", createdAt: 1000 }],
  });
  remote.queries.set("scout/activity:get", review);
  remote.queries.set("scout/activity:liveView", { url: "about:blank#watch-only" });
  remote.queries.set("tasks/sessions:controls", {
    state: {
      kind: "waiting",
      message: "Complete verification",
      callId: "call-current",
      turnId: "turn-current",
    },
    resumeAttempts: [],
    canSend: false,
    canStop: true,
    busy: false,
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
    handoffEmailFailed: false,
  });
  remote.messages = [
    { kind: "message", id: "message-1", role: "assistant", text: "I opened the site." },
  ];
  await openPlay("/tasks/game-thread");
  expect(await screen.findByText("I opened the site.")).toBeTruthy();
  expect(screen.getByTitle("Scout's live browser").getAttribute("src")).toBe(
    "about:blank#watch-only",
  );
  expect(screen.getByRole("link", { name: "Open in Agents" }).getAttribute("href")).toBe(
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
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "idle" },
      resumeAttempts: [],
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
  expect(remote.queryCalls).not.toHaveBeenCalledWith(
    "scout/chats:getScoutActivity",
    expect.anything(),
  );
  expect(remote.queryCalls).not.toHaveBeenCalledWith("humanHandoffs:forSession", expect.anything());
});

test("public managed Reviews do not request owner controls, costs, or expose the handoff", async () => {
  remote.authenticated = false;
  remote.queries.set(
    "scout/activity:get",
    session({
      purpose: { kind: "review" },
      runtime: { kind: "task", sessionId: "managed-1" },
      visibility: "public",
      isOwner: false,
      canControl: false,
      status: "waiting",
    }),
  );
  await openPlay("/tasks/game-thread");
  expect(screen.queryByLabelText("Message Scout")).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
  expect(
    screen.getByText("Sign in with the account that started this chat to continue it."),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Review with Scout" })).toBeNull();
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:controls", "skip");
  expect(remote.queryCalls).toHaveBeenCalledWith("tasks/sessions:cost", "skip");
});

test.each(["Finish signing in before resuming.", "Could not capture browser evidence."])(
  "keeps a blocked resume reason visible while waiting and disables resume and send during checking: %s",
  async (reason) => {
    const review = session({
      purpose: { kind: "review" },
      runtime: { kind: "task", sessionId: "managed-1" },
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
      resumeAttempts: [],
      canSend: false,
      canStop: true,
      busy: false,
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
      handoffEmailFailed: false,
      requestCheckMessage: reason,
    };
    remote.queries.set("scout/activity:get", review);
    remote.queries.set("tasks/sessions:controls", controls);
    remote.queries.set("scout/activity:liveView", { url: "about:blank#watch-only" });
    remote.messages = [
      { kind: "message", id: "message-1", role: "assistant", text: "I opened the site." },
    ];
    await openPlay("/tasks/game-thread");
    expect((await screen.findByRole("alert")).textContent).toBe(
      `Scout could not resume: ${reason}`,
    );
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
      remote.queries.set("tasks/sessions:controls", {
        ...controls,
        state: { kind: "checking", checkId: "resume-check-2" },
        requestCheckMessage: null,
      });
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(await screen.findByText("Checking browser…")).toBeTruthy();
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

test.each([
  {
    view: "chat",
    error: new ConvexError("Session is no longer waiting for this handoff"),
    reason: "Session is no longer waiting for this handoff",
  },
  {
    view: "walkthrough",
    error: new ConvexError("Handoff browser is not available"),
    reason: "Handoff browser is not available",
  },
  {
    view: "walkthrough",
    error: new Error("Resume failed: 503 [request_id: req-resume]"),
    reason: "Resume failed: 503 [request_id: req-resume]",
  },
])(
  "shows the actual resume request error above the $view pane: $reason",
  async ({ view, error, reason }) => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, status: "waiting" }),
    );
    remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "waiting", message: "Complete verification", callId: "call", turnId: "turn" },
      resumeAttempts: [],
      canSend: false,
      canStop: true,
      requestCheckMessage: null,
      interactiveLiveViewUrl: "https://example.test/control",
    });
    remote.resumeManaged.mockRejectedValueOnce(error);
    await openPlay(`/tasks/game-thread?view=${view}`);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Scout" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(`Scout could not resume: ${reason}`);
    expect(alert.closest("[hidden]")).toBeNull();
    const region = screen.getByRole("region", {
      name: view === "walkthrough" ? "Walkthrough with Scout" : "Conversation with Scout",
    });
    expect(alert.parentElement).toBe(region);
    expect(
      alert.compareDocumentPosition(screen.getByRole("button", { name: "Resume Scout" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Resume Scout" })).toHaveProperty("disabled", false);
  },
);

test.each(["chat", "walkthrough"])(
  "keeps resume progress and a returned rejection visible in the mobile %s view",
  async (view) => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, status: "waiting" }),
    );
    remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
    const controls = {
      state: {
        kind: "waiting",
        message: "Complete verification",
        callId: "handoff-call",
        turnId: "handoff-turn",
      },
      resumeAttempts: [],
      canSend: false,
      canStop: true,
      interactiveLiveViewUrl: "https://example.test/control",
      requestCheckMessage: null,
    };
    remote.queries.set("tasks/sessions:controls", controls);
    await openPlay(`/tasks/game-thread?view=${view}`);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Scout" }));
    await waitFor(() => expect(remote.resumeManaged).toHaveBeenCalledTimes(1));
    act(() => {
      remote.queries.set("tasks/sessions:controls", {
        ...controls,
        state: { kind: "checking", checkId: "resume-check" },
      });
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    const progress = screen
      .getAllByRole("status")
      .find((element) => element.textContent?.includes("Checking browser…"));
    expect(progress).toBeDefined();
    expect(progress?.closest("[hidden]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
    const reason = "Verification is incomplete. The page is still asking for an email code.";
    act(() => {
      remote.queries.set("tasks/sessions:controls", { ...controls, requestCheckMessage: reason });
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.getByRole("alert").textContent).toBe(`Scout could not resume: ${reason}`);
    expect(screen.getByRole("alert").closest("[hidden]")).toBeNull();
    expect(screen.getByRole("link", { name: "Open browser" }).getAttribute("href")).toBe(
      controls.interactiveLiveViewUrl,
    );
    expect(screen.getByRole("button", { name: "Resume Scout" })).toBeTruthy();
    expect(screen.queryByText("Checking browser…")).toBeNull();
  },
);

test.each(["chat", "walkthrough"])(
  "shows saved resume rejections on a stopped task in %s and retains them after a follow-up",
  async (view) => {
    remote.queries.set(
      "scout/activity:get",
      session({ purpose: { kind: "review" }, status: "stopped" }),
    );
    remote.queries.set("tasks/walkthrough:get", { walkthrough: null, captures: [] });
    const reason =
      "Goodreads requires an email code. The code is not available in the captured page.";
    const controls = {
      state: { kind: "stopped" },
      active: false,
      canSend: true,
      canStop: false,
      requestCheckMessage: null,
      interactiveLiveViewUrl: null,
      resumeAttempts: [
        { id: "resume-2", finishedAt: 1789777532049, outcome: { kind: "rejected", reason } },
        {
          id: "resume-1",
          finishedAt: 1789777506084,
          outcome: { kind: "rejected", reason: "Earlier rejection" },
        },
      ],
    };
    remote.queries.set("tasks/sessions:controls", controls);
    await openPlay(`/tasks/game-thread?view=${view}`);
    const history = await screen.findByRole("list", { name: "Resume attempts" });
    expect(
      screen.getByText(
        view === "chat" ? "Task stopped. Send a message to continue." : "Task stopped.",
      ),
    ).toBeTruthy();
    expect(history.closest("details")).toHaveProperty("open", true);
    expect(history.closest("[hidden]")).toBeNull();
    expect(within(history).getByText(reason)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
    act(() => {
      remote.queries.set(
        "scout/activity:get",
        session({ purpose: { kind: "review" }, status: "running" }),
      );
      remote.queries.set("tasks/sessions:controls", {
        ...controls,
        state: { kind: "running" },
        active: true,
        canSend: false,
      });
      remote.revision++;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(history.closest("details")).toHaveProperty("open", false);
    expect(screen.queryByText("Task stopped.", { exact: false })).toBeNull();
    expect(within(history).getByText(reason)).toBeTruthy();
    cleanup();
    await openPlay(`/tasks/game-thread?view=${view}`);
    expect(screen.getByText(reason)).toBeTruthy();
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
      `/tasks/game-thread?session=old-browser&view=chat&scope=${scope}&site=samebase.com`,
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
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks/second-review"));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
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
  await openPlay("/tasks/game-thread");
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
    const router = await openPlay("/tasks/game-thread");
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
    const router = await openPlay("/tasks/game-thread");
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
    const router = await openPlay("/tasks/game-thread?view=chat");
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

  test("the landing page starts reviews and opens the task route", async () => {
    remote.queries.set("scout/activity:get", session({ purpose: { kind: "review" } }));
    const router = await openPlay("/?site=example.com&scope=mine");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.search).toEqual({ site: "example.com", scope: "mine" });
    expect(screen.queryByRole("heading", { name: "Send a Scout instead." })).toBeNull();
    expect(screen.queryByRole("button", { name: "Find a game for us" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Message Scout"), {
      target: { value: "Review example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.createThread).toHaveBeenCalledWith({
        product: { kind: "review" },
        scoutId: "scout-1",
        prompt: "Review example.com",
        visibility: "public",
        engine: "agents_api",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks/game-thread"));
    expect(router.state.location.search).toEqual({});
    expect(await screen.findByRole("region", { name: "Conversation with Scout" })).toBeTruthy();
  });

  test("a Play conversation cannot silently open in Review mode", async () => {
    await openPlay("/tasks/game-thread");
    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeTruthy();
    expect(screen.queryByLabelText("Message Scout")).toBeNull();
  });

  test("approved members can start games without mounting admin task queries", async () => {
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
    await user.click(screen.getByRole("combobox", { name: "Task engine" }));
    await user.click(screen.getByRole("option", { name: "Luna - Convex" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.createThread).toHaveBeenCalledWith({
        product: { kind: "play" },
        scoutId: "scout-1",
        prompt: invitation,
        visibility: "public",
        engine: "convex_agent",
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
    expect(screen.queryByRole("link", { name: "Open in Agents" })).toBeNull();
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
    expect(screen.queryByRole("link", { name: "Open in Agents" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Play with Scout" })).toBeNull();
    expect(
      screen.getByText("Sign in with the account that started this chat to continue it."),
    ).toBeTruthy();
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
    expect(remote.sendManaged).not.toHaveBeenCalled();
    expect(remote.stopManaged).not.toHaveBeenCalled();
  });

  test("an unavailable session does not create a replacement chat", async () => {
    await openPlay("/play?thread=missing-thread");
    expect(await screen.findByRole("heading", { name: "Session unavailable" })).toBeTruthy();
    expect(remote.createThread).not.toHaveBeenCalled();
    expect(remote.sendManaged).not.toHaveBeenCalled();
    expect(remote.stopManaged).not.toHaveBeenCalled();
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
    expect(remote.sendManaged).not.toHaveBeenCalled();
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
      product: { kind: "play" },
      scoutId: "scout-2",
      visibility: "private",
      prompt: invitation,
      engine: "agents_api",
    });
    expect(remote.sendManaged).not.toHaveBeenCalled();
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
        product: { kind: "play" },
        scoutId: "scout-1",
        visibility: "private",
        prompt: "Find us a cooperative game for tomorrow.",
        engine: "agents_api",
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
    remote.queries.set("tasks/sessions:controls", {
      state: { kind: "running" },
      resumeAttempts: [],
      canSend: false,
      canStop: true,
      busy: false,
    });
    await openPlay("/play?thread=game-thread");
    const input = await screen.findByRole("textbox", { name: "Message Scout" });
    fireEvent.change(input, { target: { value: "Try another game." } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(remote.sendManaged).not.toHaveBeenCalled();
    expect(remote.stopManaged).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stop Scout" }));
    await waitFor(() =>
      expect(remote.stopManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
    );
    expect(screen.getByDisplayValue("Try another game.")).toBeTruthy();
    act(() => {
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "idle" },
        resumeAttempts: [],
        canSend: true,
        canStop: false,
        busy: false,
      });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
        sessionId: "managed-1",
        message: "Try another game.",
      }),
    );
    act(() => {
      remote.queries.set("tasks/sessions:controls", {
        state: { kind: "idle" },
        resumeAttempts: [],
        canSend: false,
        canStop: false,
        busy: true,
      });
      remote.revision += 1;
      remote.subscribers.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "Stop Scout" })).toBeNull();
    expect(screen.getByText("This Scout is busy in another chat.")).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Scout" }).disabled,
    ).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send message" }).disabled).toBe(
      true,
    );
    expect(document.body.textContent).not.toContain("another-game");
  });
});

test("scrolling near the start loads earlier messages one page at a time", async () => {
  remote.messageStatus = "CanLoadMore";
  remote.messages = [{ kind: "message", id: "recent", role: "assistant", text: "Recent message" }];
  remote.loadEarlierMessages.mockImplementation(() => {
    remote.messageStatus = "LoadingMore";
    remote.revision++;
    remote.subscribers.forEach((notify) => notify());
  });
  await openPlay("/play?thread=game-thread");
  const viewport = await screen.findByRole("region", { name: "Session messages" });
  const recentMessage = screen.getByText("Recent message");
  expect(screen.queryByRole("button", { name: "Earlier messages" })).toBeNull();
  expect(remote.loadEarlierMessages).not.toHaveBeenCalled();

  fireEvent.scroll(viewport, { target: { scrollTop: 200 } });
  expect(remote.loadEarlierMessages).not.toHaveBeenCalled();
  fireEvent.scroll(viewport, { target: { scrollTop: 241 } });
  expect(remote.loadEarlierMessages).not.toHaveBeenCalled();
  fireEvent.scroll(viewport, { target: { scrollTop: 240 } });
  expect(remote.loadEarlierMessages).toHaveBeenCalledExactlyOnceWith(50);
  expect(screen.getByText("Loading earlier messages…").getAttribute("role")).toBe("status");
  expect(within(screen.getByRole("log")).queryByText("Loading earlier messages…")).toBeNull();
  fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
  expect(remote.loadEarlierMessages).toHaveBeenCalledTimes(1);

  act(() => {
    remote.messages.push({ kind: "message", id: "older", role: "user", text: "Older message" });
    remote.messageStatus = "CanLoadMore";
    remote.revision++;
    remote.subscribers.forEach((notify) => notify());
  });
  expect(screen.getByRole("region", { name: "Session messages" })).toBe(viewport);
  expect(screen.getByText("Recent message")).toBe(recentMessage);
  expect(screen.queryByText("Loading earlier messages…")).toBeNull();
  expect(screen.getByRole("log").textContent).toBe("Older messagePipRecent message");

  fireEvent.scroll(viewport, { target: { scrollTop: 1000 } });
  fireEvent.scroll(viewport, { target: { scrollTop: 200 } });
  expect(remote.loadEarlierMessages).toHaveBeenCalledTimes(2);
  act(() => {
    remote.messageStatus = "Exhausted";
    remote.revision++;
    remote.subscribers.forEach((notify) => notify());
  });
  fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
  expect(remote.loadEarlierMessages).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Loading earlier messages…")).toBeNull();
});

test("scrolling while the first message page loads does not request history", async () => {
  remote.messageStatus = "LoadingFirstPage";
  await openPlay("/play?thread=game-thread");
  expect(await screen.findByText("Loading messages…")).toBeTruthy();
  fireEvent.scroll(screen.getByRole("region", { name: "Session messages" }), {
    target: { scrollTop: 0 },
  });
  expect(remote.loadEarlierMessages).not.toHaveBeenCalled();
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
  remote.queries.set("tasks/sessions:controls", {
    state: { kind: "running" },
    resumeAttempts: [],
    canSend: false,
    canStop: true,
    busy: false,
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
  expect(remote.sendManaged).not.toHaveBeenCalled();
});

test("Enter sends a message but composition and Shift+Enter do not", async () => {
  await openPlay("/play?thread=game-thread");
  const input = screen.getByLabelText("Message Scout");
  fireEvent.change(input, { target: { value: "Your turn." } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(remote.sendManaged).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(remote.sendManaged).toHaveBeenCalledExactlyOnceWith({
      sessionId: "managed-1",
      message: "Your turn.",
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
  remote.queries.set("tasks/sessions:controls", {
    state: {
      kind: "waiting",
      message: "Please complete the verification.",
      callId: "call-current",
      turnId: "turn-current",
    },
    resumeAttempts: [],
    canSend: false,
    canStop: true,
    busy: false,
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
  });
  await openPlay("/play?thread=game-thread");
  const browser = await screen.findByTitle("Scout's live browser");
  fireEvent.click(screen.getByRole("button", { name: "Show Scout’s view" }));
  expect(screen.getByTitle("Scout's live browser")).toBe(browser);
  expect(
    within(screen.getByRole("region", { name: "Conversation with Scout" }))
      .getByRole("link", { name: "Open browser" })
      .getAttribute("href"),
  ).toBe("https://liveview.firecrawl.dev/control");
  expect(screen.getAllByRole("button", { name: "Stop Scout" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByTitle("Scout's live browser")).toBe(browser);
  fireEvent.click(screen.getAllByRole("button", { name: "Stop Scout" })[0]);
  await waitFor(() =>
    expect(remote.stopManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: "managed-1" }),
  );
});

test("selects older replays without changing the conversation or current handoff", async () => {
  const sessions = [
    { engine: "convex_agent", sessionId: "older", createdAt: 1_000, kind: "closed" },
    { engine: "convex_agent", sessionId: "current", createdAt: 2_000, kind: "active" },
  ];
  remote.queries.set("scout/activity:get", session({ sessions }));
  remote.queries.set("scout/activity:liveView:current", { url: "about:blank" });
  remote.queries.set("tasks/sessions:controls", {
    state: {
      kind: "waiting",
      message: "Complete the verification.",
      callId: "call-current",
      turnId: "turn-current",
    },
    resumeAttempts: [],
    canSend: false,
    canStop: true,
    busy: false,
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/control",
  });
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
  expect(screen.getByRole("link", { name: "Open browser" }).getAttribute("href")).toBe(
    "https://liveview.firecrawl.dev/control",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByDisplayValue("Keep this draft.")).toBeTruthy();
  expect(remote.sendManaged).not.toHaveBeenCalled();
  expect(remote.stopManaged).not.toHaveBeenCalled();

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
      runtime: { kind: "task", sessionId: "managed-1" },
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
  await openPlay("/tasks/game-thread?view=chat");
  expect(screen.queryByRole("link", { name: "Open in Agents" })).toBeNull();
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
  expect(remote.sendManaged).not.toHaveBeenCalled();
  expect(remote.stopManaged).not.toHaveBeenCalled();
});
