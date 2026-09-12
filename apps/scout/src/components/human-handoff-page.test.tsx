// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
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
  Link: ({ children, search }: { children: ReactNode; search: { thread: string } }) => (
    <a href={`/chats?thread=${search.thread}`}>{children}</a>
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
  window.sessionStorage.clear();
  window.history.replaceState({}, "", `/handoff/handoff-1#access=${accessToken}`);
});

afterEach(() => cleanup());

describe("HumanHandoffPage", () => {
  test("keeps the emailed bearer while opening without an authenticated owner", async () => {
    testState.load.mockResolvedValue(waitingPage());

    render(
      <StrictMode>
        <HumanHandoffPage handoffId="handoff-1" />
      </StrictMode>,
    );

    expect(await screen.findByTitle("Interactive Scout browser")).toBeTruthy();
    expect(testState.load).toHaveBeenCalled();
    expect(testState.load.mock.calls).toEqual(
      expect.arrayContaining([[{ handoffId: "handoff-1", accessToken }]]),
    );
    expect(testState.load).not.toHaveBeenCalledWith({ handoffId: "handoff-1" });
  });

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
    expect(screen.getByText("Expires in 01:00")).toBeTruthy();
    const fallback = screen.getByRole("link", { name: /Open browser in a new tab/i });
    expect(fallback.getAttribute("href")).toBe(providerUrl);
    expect(fallback.getAttribute("rel")).toBe("noreferrer noopener");
    expect(testState.continueHandoff).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    expect(testState.load).toHaveBeenCalledOnce();

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

  test("lets the authenticated owner return to the database-derived chat", async () => {
    window.history.replaceState({}, "", "/handoff/handoff-1");
    testState.auth = { isLoading: false, isAuthenticated: true };
    testState.load.mockResolvedValue(waitingPage());
    testState.continueHandoff.mockResolvedValue({
      status: "continued",
      handoffId: "handoff-1",
      reason: "Complete GitHub's CAPTCHA.",
      continuedAt: Date.now(),
      scoutName: "Conrad Scout",
      destination: { threadId: "thread-1" },
    });

    render(<HumanHandoffPage handoffId="handoff-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "I completed the check. Continue Scout" }),
    );

    expect(testState.load).toHaveBeenCalledWith({ handoffId: "handoff-1" });
    expect(screen.getByRole("link", { name: "Return to chat" }).getAttribute("href")).toBe(
      "/chats?thread=thread-1",
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

  test("explains a Scout failure without claiming it resumed", async () => {
    testState.load.mockResolvedValue({
      status: "failed",
      failedAt: Date.now(),
      failure: "scout_failed",
      handoffId: "handoff-1",
      reason: "Complete GitHub's CAPTCHA.",
      scoutName: "Conrad Scout",
      destination: { threadId: "thread-1" },
    });

    render(<HumanHandoffPage handoffId="handoff-1" />);

    expect(
      await screen.findByText("Scout stopped before resuming. Return to the chat to try again."),
    ).toBeTruthy();
    expect(screen.queryByTitle("Interactive Scout browser")).toBeNull();
    expect(screen.getByRole("link", { name: "Return to chat" })).toBeTruthy();
  });

  test("blocks all access when embedded in another page", async () => {
    testState.topLevel = false;

    render(<HumanHandoffPage handoffId="handoff-1" />);

    expect(await screen.findByText("Open this handoff in a top-level browser tab.")).toBeTruthy();
    expect(testState.load).not.toHaveBeenCalled();
    expect(testState.continueHandoff).not.toHaveBeenCalled();
  });
});
