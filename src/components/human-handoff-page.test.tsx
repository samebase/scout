// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { HumanHandoffPage } from "./human-handoff-page";

const testState = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: false },
  continueHandoff: vi.fn(),
  hookCalls: 0,
  load: vi.fn(),
  topLevel: true,
}));

vi.mock("convex/react", () => ({
  Authenticated: () => null,
  AuthLoading: () => null,
  Unauthenticated: ({ children }: { children: ReactNode }) => children,
  useAction: () => (testState.hookCalls++ % 2 === 0 ? testState.load : testState.continueHandoff),
  useConvexAuth: () => testState.auth,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: ReactNode;
    params: { domain: string; taskId: string; attemptId: string };
  }) => (
    <a href={`/products/${params.domain}/tasks/${params.taskId}/attempts/${params.attemptId}`}>
      {children}
    </a>
  ),
}));

vi.mock("#components/auth-panel", () => ({
  AuthPanel: () => <div>Sign-in panel</div>,
}));

vi.mock("#lib/human-handoff-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#lib/human-handoff-access")>();
  return {
    ...actual,
    humanHandoffIsTopLevel: () => testState.topLevel,
  };
});

const accessToken = `hh1_${"a".repeat(43)}`;
const providerUrl = "about:blank#private-control";

function waitingPage() {
  return {
    status: "waiting" as const,
    handoffId: "handoff-1",
    reason: "Complete GitHub's CAPTCHA.",
    expiresAt: Date.now() + 60_000,
    serverNow: Date.now(),
    scoutName: "Conrad Scout",
    interactiveLiveViewUrl: providerUrl,
  };
}

beforeEach(() => {
  testState.hookCalls = 0;
  testState.topLevel = true;
  testState.auth = { isLoading: false, isAuthenticated: false };
  testState.load.mockReset();
  testState.continueHandoff.mockReset();
  window.history.replaceState({}, "", `/handoff/handoff-1#access=${accessToken}`);
});

afterEach(() => cleanup());

describe("HumanHandoffPage", () => {
  test("scrubs the bearer before loading and continues only after the explicit click", async () => {
    testState.load.mockImplementation(async () => {
      expect(window.location.hash).toBe("");
      return waitingPage();
    });
    testState.continueHandoff.mockResolvedValue({
      status: "continued",
      handoffId: "handoff-1",
      reason: "Complete GitHub's CAPTCHA.",
      continuedAt: Date.now(),
      scoutName: "Conrad Scout",
    });

    render(<HumanHandoffPage handoffId="handoff-1" />);

    const frame = await screen.findByTitle("Interactive Scout browser");
    expect(frame.getAttribute("src")).toBe(providerUrl);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("sandbox")).toBe("allow-forms allow-same-origin allow-scripts");
    expect(screen.getByText("Complete GitHub's CAPTCHA.")).toBeTruthy();
    const fallback = screen.getByRole("link", { name: /Open browser in a new tab/i });
    expect(fallback.getAttribute("href")).toBe(providerUrl);
    expect(fallback.getAttribute("rel")).toBe("noreferrer noopener");
    expect(testState.continueHandoff).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(testState.load).toHaveBeenCalledTimes(2));

    await userEvent.click(
      screen.getByRole("button", { name: "I completed the check. Continue Scout" }),
    );

    expect(testState.load).toHaveBeenCalledWith({ handoffId: "handoff-1", accessToken });
    expect(testState.continueHandoff).toHaveBeenCalledOnce();
    expect(testState.continueHandoff).toHaveBeenCalledWith({
      handoffId: "handoff-1",
      accessToken,
    });
    expect(await screen.findByText("Control returned to Scout")).toBeTruthy();
    expect(screen.queryByTitle("Interactive Scout browser")).toBeNull();
  });

  test("lets the authenticated owner return to the exact database-derived Attempt", async () => {
    window.history.replaceState({}, "", "/handoff/handoff-1");
    testState.auth = { isLoading: false, isAuthenticated: true };
    testState.load.mockResolvedValue(waitingPage());
    testState.continueHandoff.mockResolvedValue({
      status: "continued",
      handoffId: "handoff-1",
      reason: "Complete GitHub's CAPTCHA.",
      continuedAt: Date.now(),
      scoutName: "Conrad Scout",
      destination: { domain: "github.com", taskId: "task-1", attemptId: "attempt-1" },
    });

    render(<HumanHandoffPage handoffId="handoff-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "I completed the check. Continue Scout" }),
    );

    expect(testState.load).toHaveBeenCalledWith({ handoffId: "handoff-1" });
    expect(screen.getByRole("link", { name: "Return to attempt" }).getAttribute("href")).toBe(
      "/products/github.com/tasks/task-1/attempts/attempt-1",
    );
  });

  test.each([
    { status: "expired", expiredAt: Date.now(), title: "This handoff expired" },
    {
      status: "failed",
      failedAt: Date.now(),
      failure: "browser_ended",
      title: "This handoff failed",
    },
  ])("renders $status without browser controls", async (terminal) => {
    testState.load.mockResolvedValue({
      ...terminal,
      handoffId: "handoff-1",
      reason: "Complete GitHub's CAPTCHA.",
      scoutName: "Conrad Scout",
    });

    render(<HumanHandoffPage handoffId="handoff-1" />);

    expect(await screen.findByText(terminal.title)).toBeTruthy();
    expect(screen.queryByTitle("Interactive Scout browser")).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue Scout/ })).toBeNull();
  });

  test("blocks all access when embedded in another page", async () => {
    testState.topLevel = false;

    render(<HumanHandoffPage handoffId="handoff-1" />);

    expect(await screen.findByText("Open this handoff in a top-level browser tab.")).toBeTruthy();
    expect(testState.load).not.toHaveBeenCalled();
    expect(testState.continueHandoff).not.toHaveBeenCalled();
  });
});
