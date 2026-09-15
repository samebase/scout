// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { api } from "../../convex/_generated/api";
import { TaskWalkthrough } from "./task-walkthrough";

type Result = FunctionReturnType<typeof api.agentsApi.walkthrough.get>;
type Capture = NonNullable<Result>["captures"][number];
type ImageResult = FunctionReturnType<typeof api.agentsApi.screenshots.imageUrl>;
// @ts-expect-error The mocked Convex transport uses this stable string in place of a database-generated session ID.
const firstSession: FunctionArgs<typeof api.agentsApi.walkthrough.get>["sessionId"] =
  "session-first";
// @ts-expect-error The mocked Convex transport uses this stable string in place of a database-generated session ID.
const secondSession: FunctionArgs<typeof api.agentsApi.walkthrough.get>["sessionId"] =
  "session-second";
// @ts-expect-error The mocked Convex transport uses this stable string in place of a database-generated screenshot ID.
const firstId: Capture["id"] = "capture-first";
// @ts-expect-error The mocked Convex transport uses this stable string in place of a database-generated screenshot ID.
const secondId: Capture["id"] = "capture-second";

const remote = vi.hoisted(() => ({
  results: new Map<string, Result | undefined>(),
  listeners: new Set<() => void>(),
  revision: 0,
  imageUrl:
    vi.fn<
      (args: FunctionArgs<typeof api.agentsApi.screenshots.imageUrl>) => Promise<ImageResult>
    >(),
}));

vi.mock("convex/react", () => ({
  useQuery: (
    _reference: unknown,
    { sessionId }: FunctionArgs<typeof api.agentsApi.walkthrough.get>,
  ) => {
    useSyncExternalStore(
      (listener) => {
        remote.listeners.add(listener);
        return () => remote.listeners.delete(listener);
      },
      () => remote.revision,
    );
    return remote.results.get(sessionId);
  },
  useAction: () => remote.imageUrl,
}));

function capture(id: Capture["id"], note: string): Capture {
  return {
    id,
    note,
    browserSequence: 0,
    operationSequence: id === firstId ? 1 : 2,
    state: {
      kind: "ready",
      metadata: {
        tabId: "tab-1",
        url: "https://example.com/play",
        title: "Score Four",
        startedAtMs: 100,
        completedAtMs: 120,
        width: 1280,
        height: 1800,
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
      },
    },
  };
}

function report(): NonNullable<Result> {
  return {
    walkthrough: {
      summary: "Playing, undoing a move, and starting again all worked.",
      sections: [
        {
          heading: "Play a move",
          explanation: "The piece lands in the selected column.",
          captureIds: [firstId],
        },
        {
          heading: "Undo the move",
          explanation: "Undo restores the previous board.",
          captureIds: [secondId],
        },
      ],
    },
    captures: [
      capture(secondId, "An empty board after undo"),
      capture(firstId, "A piece in the board"),
    ],
  };
}

function publish(sessionId: string, result: Result | undefined) {
  act(() => {
    remote.results.set(sessionId, result);
    remote.revision += 1;
    remote.listeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  remote.results.clear();
  remote.revision = 0;
  remote.imageUrl.mockReset().mockImplementation(async ({ screenshotId }) => ({
    url: `https://images.example.com/${screenshotId}.png`,
    expiresAtMs: Date.now() + 60_000,
  }));
  remote.results.set(firstSession, report());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("follows the illustrated report order and loads only the selected original", async () => {
  render(<TaskWalkthrough sessionId={firstSession} />);
  expect(await screen.findByRole("img", { name: "A piece in the board" })).toHaveProperty(
    "width",
    1280,
  );
  expect(screen.getByText("1 of 2")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Previous" }).disabled).toBe(true);
  expect(remote.imageUrl).toHaveBeenCalledExactlyOnceWith({ screenshotId: firstId });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("img", { name: "A piece in the board" })).toBeNull();
  expect(await screen.findByRole("img", { name: "An empty board after undo" })).toHaveProperty(
    "height",
    1800,
  );
  expect(screen.getByRole("heading", { name: "Undo the move" })).toBeTruthy();
  expect(screen.queryByText("Playing, undoing a move, and starting again all worked.")).toBeNull();
  expect(screen.getByText("2 of 2")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("link", { name: /example.com\/play/ }).getAttribute("href")).toBe(
    "https://example.com/play",
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByRole("heading", { name: "Play a move" })).toBeTruthy();
  expect(screen.getByText("Playing, undoing a move, and starting again all worked.")).toBeTruthy();
});

test("shows notes in capture creation order while the final walkthrough is absent", async () => {
  remote.results.set(firstSession, {
    walkthrough: null,
    captures: [
      { ...capture(firstId, "The board is open"), state: { kind: "pending" } },
      {
        ...capture(secondId, "Undo was selected"),
        state: { kind: "failed", message: "The page closed before it was saved." },
      },
    ],
  });
  render(<TaskWalkthrough sessionId={firstSession} />);
  expect(screen.getByText("Captured so far")).toBeTruthy();
  expect(screen.getByText("The board is open")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Saving screenshot");
  expect(remote.imageUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Undo was selected")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("The page closed before it was saved.");
  expect(remote.imageUrl).not.toHaveBeenCalled();
  publish(firstSession, {
    walkthrough: null,
    captures: [capture(firstId, "The board is open"), capture(secondId, "Undo was selected")],
  });
  expect(await screen.findByRole("img", { name: "Undo was selected" })).toBeTruthy();
  expect(remote.imageUrl).toHaveBeenCalledExactlyOnceWith({ screenshotId: secondId });
});

test("distinguishes loading, access denial, and an empty older task", () => {
  remote.results.set(firstSession, undefined);
  render(<TaskWalkthrough sessionId={firstSession} />);
  expect(screen.getByRole("status").textContent).toContain("Loading walkthrough");
  publish(firstSession, null);
  expect(screen.getByRole("heading", { name: "Walkthrough unavailable" })).toBeTruthy();
  publish(firstSession, { walkthrough: null, captures: [] });
  expect(screen.getByRole("heading", { name: "No screenshots saved" })).toBeTruthy();
  expect(screen.getByText("Read the chat for this task’s findings.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(remote.imageUrl).not.toHaveBeenCalled();
});

test("a task switch removes the old image immediately and resets navigation", async () => {
  const view = render(<TaskWalkthrough sessionId={firstSession} />);
  await screen.findByRole("img", { name: "A piece in the board" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("img", { name: "An empty board after undo" });
  view.rerender(<TaskWalkthrough sessionId={secondSession} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Loading walkthrough");
  publish(secondSession, report());
  expect(await screen.findByRole("img", { name: "A piece in the board" })).toBeTruthy();
  expect(screen.getByText("1 of 2")).toBeTruthy();
});

test("ignores image requests that finish after a task switch", async () => {
  let resolveOldImage: (value: ImageResult) => void = () => {
    throw new Error("Image request has not started.");
  };
  remote.imageUrl.mockImplementationOnce(
    () =>
      new Promise<ImageResult>((resolve) => {
        resolveOldImage = resolve;
      }),
  );
  const view = render(<TaskWalkthrough sessionId={firstSession} />);
  remote.results.set(secondSession, {
    walkthrough: null,
    captures: [capture(secondId, "The new task")],
  });
  view.rerender(<TaskWalkthrough sessionId={secondSession} />);
  const current = await screen.findByRole("img", { name: "The new task" });
  await act(async () =>
    resolveOldImage({
      url: "https://images.example.com/stale.png",
      expiresAtMs: Date.now() + 60_000,
    }),
  );
  expect(screen.getByRole("img")).toBe(current);
  expect(current.getAttribute("src")).not.toContain("stale");
});

test("expands the screenshot to fit a focus-trapped dialog and returns focus after Escape", async () => {
  const user = userEvent.setup();
  render(<TaskWalkthrough sessionId={firstSession} />);
  await screen.findByRole("img", { name: "A piece in the board" });
  const expand = screen.getByRole("button", { name: "Expand" });
  await user.click(expand);
  const dialog = screen.getByRole("dialog", { name: "Play a move" });
  expect(within(dialog).getByRole("img").className).toContain("object-contain");
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab();
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(remote.imageUrl).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(expand);
});

test("refreshes a failed image once, then offers an explicit retry", async () => {
  render(<TaskWalkthrough sessionId={firstSession} />);
  fireEvent.error(await screen.findByRole("img", { name: "A piece in the board" }));
  await waitFor(() => expect(remote.imageUrl).toHaveBeenCalledTimes(2));
  fireEvent.error(await screen.findByRole("img", { name: "A piece in the board" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Couldn’t load this screenshot. Try again.",
  );
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("img", { name: "A piece in the board" });
  expect(remote.imageUrl).toHaveBeenCalledTimes(3);
});

test("renews expiring URLs without spending the image-error retry budget or removing the loaded image", async () => {
  vi.useFakeTimers();
  await act(async () => {
    render(<TaskWalkthrough sessionId={firstSession} />);
  });
  expect(screen.getByRole("img")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("img")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByRole("img")).toBeTruthy();
  expect(remote.imageUrl).toHaveBeenCalledTimes(3);
  await act(async () => {
    fireEvent.error(screen.getByRole("img"));
  });
  expect(screen.getByRole("img")).toBeTruthy();
  expect(remote.imageUrl).toHaveBeenCalledTimes(4);
  await act(async () => {
    fireEvent.error(screen.getByRole("img"));
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(remote.imageUrl).toHaveBeenCalledTimes(4);
});

test("shows revoked or failed image access without mounting a broken image", async () => {
  remote.imageUrl.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Offline"));
  render(<TaskWalkthrough sessionId={firstSession} />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This screenshot is no longer available.",
  );
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Couldn’t load this screenshot. Try again.",
  );
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
});

test("a failed URL renewal keeps the loaded screenshot, while revoked access removes it", async () => {
  vi.useFakeTimers();
  remote.imageUrl
    .mockResolvedValueOnce({
      url: "https://images.example.com/loaded.png",
      expiresAtMs: Date.now() + 60_000,
    })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(null);
  await act(async () => {
    render(<TaskWalkthrough sessionId={firstSession} />);
  });
  const loaded = screen.getByRole("img");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("img")).toBe(loaded);
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(remote.imageUrl).toHaveBeenCalledTimes(2);
  await act(async () => {
    fireEvent.error(loaded);
  });
  expect(remote.imageUrl).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("This screenshot is no longer available.");
});
