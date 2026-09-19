// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { api } from "../../convex/_generated/api";
import { HumanHandoffPage } from "./human-handoff-page";

type Page = FunctionReturnType<typeof api.tasks.handoff.load>;
const remote = vi.hoisted(() => ({
  load: vi.fn<() => Promise<Page>>(),
  resume: vi.fn<() => Promise<Page>>(),
}));
vi.mock("convex/react", () => ({
  useAction: (reference: FunctionReference<"action">) => {
    switch (getFunctionName(reference)) {
      case "tasks/handoff:load":
        return remote.load;
      case "tasks/handoff:resume":
        return remote.resume;
      default:
        throw new Error("Unexpected action");
    }
  },
}));

const token = `hh1_${"a".repeat(43)}`;
const nextToken = `hh1_${"b".repeat(43)}`;
const waiting = {
  status: "waiting",
  scoutName: "Robin",
  message: "Sign in to continue the booking.",
  interactiveLiveViewUrl: "about:blank",
  checkMessage: null,
  expiresAt: Date.UTC(2026, 8, 19, 10, 10),
} satisfies Page;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", `/handoff/session#access=${token}`);
  remote.load.mockReset().mockResolvedValue(waiting);
  remote.resume.mockReset().mockResolvedValue({ status: "continued", scoutName: "Robin" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each(["", "#access=wrong", `#access=${token}&extra=1`])(
  "missing or invalid token %s never loads a browser",
  async (fragment) => {
    window.history.replaceState({}, "", `/handoff/session${fragment}`);
    render(<HumanHandoffPage sessionId="session" />);
    expect((await screen.findByRole("alert")).textContent).toContain("valid access token");
    expect(remote.load).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Scout browser")).toBeNull();
    expect(window.location.hash).toBe("");
  },
);

test("the email token is stripped, survives a tab reload, and stays scoped to its session", async () => {
  window.localStorage.setItem("auth-marker", "unchanged");
  const first = render(<HumanHandoffPage sessionId="session" />);
  expect(await screen.findByTitle("Scout browser")).toBeTruthy();
  expect(window.location.hash).toBe("");
  expect(remote.load).toHaveBeenCalledWith({ sessionId: "session", accessToken: token });
  expect(screen.getByText(waiting.message)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open browser in a new tab" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
  expect(screen.getByTitle("Scout browser").getAttribute("referrerpolicy")).toBe("no-referrer");
  first.unmount();
  const reloaded = render(<HumanHandoffPage sessionId="session" />);
  expect(await screen.findByTitle("Scout browser")).toBeTruthy();
  expect(remote.load).toHaveBeenCalledTimes(2);
  reloaded.unmount();
  window.history.replaceState({}, "", "/handoff/another-session");
  render(<HumanHandoffPage sessionId="another-session" />);
  expect((await screen.findByRole("alert")).textContent).toContain("valid access token");
  expect(remote.load).toHaveBeenCalledTimes(2);
  expect(window.localStorage.getItem("auth-marker")).toBe("unchanged");
  window.localStorage.removeItem("auth-marker");
});

test("an invalid fragment clears a previously stored token", async () => {
  const first = render(<HumanHandoffPage sessionId="session" />);
  await screen.findByTitle("Scout browser");
  first.unmount();
  window.history.replaceState({}, "", "/handoff/session#access=invalid");
  const invalid = render(<HumanHandoffPage sessionId="session" />);
  await screen.findByRole("alert");
  invalid.unmount();
  render(<HumanHandoffPage sessionId="session" />);
  expect((await screen.findByRole("alert")).textContent).toContain("valid access token");
  expect(remote.load).toHaveBeenCalledOnce();
});

test.each(["continued", "request error"])(
  "a new email fragment replaces %s on the same session and survives reload",
  async (previous) => {
    if (previous === "continued")
      remote.load.mockResolvedValueOnce({ status: "continued", scoutName: "Robin" });
    else remote.load.mockRejectedValueOnce(new Error("Previous handoff request failed"));
    const first = render(<HumanHandoffPage sessionId="session" />);
    if (previous === "continued")
      await screen.findByText("Robin has continued. You can close this tab.");
    else await screen.findByText("Previous handoff request failed");

    act(() => {
      window.location.hash = `access=${nextToken}`;
    });
    expect(await screen.findByTitle("Scout browser")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Robin has continued. You can close this tab.")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(remote.load).toHaveBeenLastCalledWith({ sessionId: "session", accessToken: nextToken });
    fireEvent.click(screen.getByRole("button", { name: "Resume Scout" }));
    expect(remote.resume).toHaveBeenCalledWith({ sessionId: "session", accessToken: nextToken });
    await screen.findByText("Robin has continued. You can close this tab.");

    first.unmount();
    render(<HumanHandoffPage sessionId="session" />);
    expect(await screen.findByTitle("Scout browser")).toBeTruthy();
    expect(remote.load).toHaveBeenLastCalledWith({ sessionId: "session", accessToken: nextToken });
  },
);

test.each(["load", "resume"])(
  "a new email fragment starts loading while the old %s is pending and ignores its result",
  async (operation) => {
    let resolvePrevious: (page: Page) => void;
    const previous = new Promise<Page>((resolve) => {
      resolvePrevious = resolve;
    });
    if (operation === "load") remote.load.mockReturnValueOnce(previous);
    else remote.resume.mockReturnValueOnce(previous);
    await act(async () => {
      render(<HumanHandoffPage sessionId="session" />);
    });
    if (operation === "resume")
      fireEvent.click(screen.getByRole("button", { name: "Resume Scout" }));
    remote.load.mockResolvedValue({ ...waiting, message: "Complete the next verification." });

    act(() => {
      window.location.hash = `access=${nextToken}`;
    });
    await screen.findByText("Complete the next verification.");
    expect(remote.load).toHaveBeenLastCalledWith({ sessionId: "session", accessToken: nextToken });
    await act(async () => {
      resolvePrevious({ status: "continued", scoutName: "Robin" });
    });
    expect(screen.getByTitle("Scout browser")).toBeTruthy();
    expect(screen.getByText("Complete the next verification.")).toBeTruthy();
    expect(screen.queryByText("Robin has continued. You can close this tab.")).toBeNull();
  },
);

test("a replacement token clears the old browser and poll while its new request loads", async () => {
  vi.useFakeTimers();
  let resolveNext: (page: Page) => void;
  remote.load.mockResolvedValueOnce(waiting).mockReturnValueOnce(
    new Promise<Page>((resolve) => {
      resolveNext = resolve;
    }),
  );
  await act(async () => {
    render(<HumanHandoffPage sessionId="session" />);
  });
  expect(screen.getByTitle("Scout browser")).toBeTruthy();
  await act(async () => {
    window.history.replaceState({}, "", `/handoff/session#access=${nextToken}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Loading handoff status…");
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(remote.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveNext(waiting);
  });
  expect(screen.getByTitle("Scout browser")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(remote.load).toHaveBeenCalledTimes(3);
  expect(remote.load).toHaveBeenLastCalledWith({ sessionId: "session", accessToken: nextToken });
});

test("an invalid replacement fragment removes current browser access without remounting", async () => {
  render(<HumanHandoffPage sessionId="session" />);
  await screen.findByTitle("Scout browser");
  act(() => {
    window.location.hash = "access=invalid";
  });
  expect((await screen.findByRole("alert")).textContent).toContain("valid access token");
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  expect(window.location.hash).toBe("");
  expect(window.sessionStorage.length).toBe(0);
  expect(remote.load).toHaveBeenCalledOnce();
});

test("an embedded handoff never consumes the token or contacts the backend", async () => {
  vi.spyOn(window, "top", "get").mockReturnValue(null);
  render(<HumanHandoffPage sessionId="session" />);
  expect((await screen.findByRole("alert")).textContent).toContain("own browser tab");
  expect(remote.load).not.toHaveBeenCalled();
  expect(window.sessionStorage.length).toBe(0);
});

test("a denied resume shows its explanation and a later success closes the browser", async () => {
  remote.resume.mockResolvedValueOnce({
    ...waiting,
    checkMessage: "The sign-in form is still open. Finish signing in first.",
  });
  const user = userEvent.setup();
  render(<HumanHandoffPage sessionId="session" />);
  await user.click(await screen.findByRole("button", { name: "Resume Scout" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The sign-in form is still open. Finish signing in first.",
  );
  expect(remote.resume).toHaveBeenCalledWith({ sessionId: "session", accessToken: token });
  expect(screen.getByTitle("Scout browser")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Resume Scout" }));
  expect(await screen.findByText("Robin has continued. You can close this tab.")).toBeTruthy();
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "Open browser in a new tab", hidden: true }),
  ).toBeNull();
});

test("a thrown resume error hides browser controls and shows actual details until manual reload", async () => {
  remote.resume.mockRejectedValueOnce(
    new ConvexError("Browser capture failed: 429 RATE_LIMIT, request req_123"),
  );
  const user = userEvent.setup();
  render(<HumanHandoffPage sessionId="session" />);
  await user.click(await screen.findByRole("button", { name: "Resume Scout" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Browser capture failed: 429 RATE_LIMIT, request req_123",
  );
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Reload handoff" }));
  expect(await screen.findByTitle("Scout browser")).toBeTruthy();
});

test("a failed poll removes previous browser access and waits for manual reload", async () => {
  vi.useFakeTimers();
  remote.load
    .mockResolvedValueOnce(waiting)
    .mockRejectedValue(new Error("Access revoked: 403 FORBIDDEN, request req_789"));
  await act(async () => {
    render(<HumanHandoffPage sessionId="session" />);
  });
  expect(screen.getByTitle("Scout browser")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole("alert").textContent).toBe(
    "Access revoked: 403 FORBIDDEN, request req_789",
  );
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "Open browser in a new tab", hidden: true }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume Scout" })).toBeNull();
  expect(screen.getByRole("button", { name: "Reload handoff" })).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(remote.load).toHaveBeenCalledTimes(2);
});

test.each<Page>([
  { status: "expired" },
  { status: "stopped" },
  { status: "continued", scoutName: "Robin" },
  { status: "failed", error: "Browser provider failed: 503, request req_456", diagnostic: null },
])("polling closes the browser when the task is $status", async (terminal) => {
  vi.useFakeTimers();
  remote.load.mockResolvedValueOnce(waiting).mockResolvedValue(terminal);
  await act(async () => {
    render(<HumanHandoffPage sessionId="session" />);
  });
  expect(screen.getByTitle("Scout browser")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(remote.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  if (terminal.status === "failed")
    expect(screen.getByRole("alert").textContent).toBe(terminal.error);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(remote.load).toHaveBeenCalledTimes(2);
});

test("the countdown shows the existing deadline without extra requests", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(waiting.expiresAt - 125_000);
  const view = await act(async () => render(<HumanHandoffPage sessionId="session" />));
  expect(screen.getByText("2:05 remaining")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(screen.getByText("2:04 remaining")).toBeTruthy();
  expect(remote.load).toHaveBeenCalledOnce();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("checking keeps polling until Scout continues", async () => {
  vi.useFakeTimers();
  remote.load
    .mockResolvedValueOnce({
      status: "checking",
      scoutName: "Robin",
      expiresAt: waiting.expiresAt,
    })
    .mockResolvedValue({ status: "continued", scoutName: "Robin" });
  await act(async () => {
    render(<HumanHandoffPage sessionId="session" />);
  });
  expect(screen.getByRole("status").textContent).toContain("Checking");
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText("Robin has continued. You can close this tab.")).toBeTruthy();
});

test("failed handoffs retain the provider message and diagnostic details", async () => {
  remote.load.mockResolvedValue({
    status: "failed",
    error: "Resume failed with an API error",
    diagnostic: {
      category: "transient_service",
      operation: "resume",
      occurredAtMs: Date.UTC(2026, 8, 19, 10),
      provider: "openai",
      httpStatus: 503,
      providerCode: "service_error",
      requestId: "req_handoff",
      message: "The tool result could not be accepted",
    },
  });
  render(<HumanHandoffPage sessionId="session" />);
  expect(await screen.findByText("The tool result could not be accepted")).toBeTruthy();
  expect(screen.getByText("Details")).toBeTruthy();
  expect(screen.getByText(/"httpStatus": 503/).textContent).toContain('"requestId": "req_handoff"');
  expect(screen.getByText(/"providerCode": "service_error"/).textContent).toContain(
    '"error": "Resume failed with an API error"',
  );
});

test("a delayed Resume response starts polling until Scout continues", async () => {
  vi.useFakeTimers();
  remote.load
    .mockResolvedValueOnce(waiting)
    .mockResolvedValue({ status: "continued", scoutName: "Robin" });
  let resolveResume: (page: Page) => void;
  remote.resume.mockReturnValue(
    new Promise<Page>((resolve) => {
      resolveResume = resolve;
    }),
  );
  await act(async () => {
    render(<HumanHandoffPage sessionId="session" />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Resume Scout" }));
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole("status").textContent).toContain("Checking");
  expect(remote.load).toHaveBeenCalledOnce();
  await act(async () => {
    resolveResume({
      status: "checking",
      scoutName: "Robin",
      expiresAt: waiting.expiresAt,
    });
  });
  expect(screen.getByRole("status").textContent).toContain("Checking");
  expect(screen.queryByTitle("Scout browser")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText("Robin has continued. You can close this tab.")).toBeTruthy();
});
