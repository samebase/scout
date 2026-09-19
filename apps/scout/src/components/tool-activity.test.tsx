// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ToolActivity } from "../../shared/toolActivity";
import type { Id } from "../../convex/_generated/dataModel";
import { ToolActivityRow } from "./tool-activity";

afterEach(cleanup);

const imageUrl = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => imageUrl }));

const running: ToolActivity = {
  id: "browser-call-1",
  name: "browser_execute",
  state: "running",
  preview: "await page.title()",
  input: "await page.title()",
  output: null,
  error: null,
  links: [],
  captures: [],
};

test("keeps expanded inputs open as the same call receives its result", () => {
  const { rerender } = render(<ToolActivityRow tool={running} />);
  const trigger = screen.getByRole("button", { name: "browser_execute: Running" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Input")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText("Input")).toBeTruthy();

  rerender(<ToolActivityRow tool={{ ...running, state: "completed", output: "Pika" }} />);
  expect(
    screen.getByRole("button", { name: "browser_execute: Finished" }).getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByText("Pika")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

test("offers result links without requiring the details to be expanded", () => {
  render(
    <ToolActivityRow
      tool={{
        ...running,
        state: "completed",
        links: [{ label: "Open website", url: "https://example.com/" }],
      }}
    />,
  );
  const link = screen.getByRole("link", { name: "Open website" });
  expect(link.getAttribute("href")).toBe("https://example.com/");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
});

test("shows failed and interrupted calls without implying success", () => {
  const { rerender } = render(
    <ToolActivityRow tool={{ ...running, state: "failed", error: "Navigation timed out" }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "browser_execute: Failed" }));
  expect(screen.getByText("Navigation timed out")).toBeTruthy();
  expect(screen.queryByText("Finished")).toBeNull();
  const reason =
    "Browser handoff was cancelled because the task stopped before browser control returned to Scout.";
  rerender(<ToolActivityRow tool={{ ...running, state: "interrupted", error: reason }} />);
  expect(screen.getByRole("button", { name: "browser_execute: Interrupted" })).toBeTruthy();
  expect(screen.getByText("Reason")).toBeTruthy();
  expect(screen.getByText(reason)).toBeTruthy();
  expect(screen.queryByText("Error")).toBeNull();
});

test("loads a screenshot only when opened and reuses its unexpired URL", async () => {
  // @ts-expect-error The fixture is a stand-in for the server-validated screenshot ID.
  const captureId: Id<"agentsApiScreenshots"> = "capture-1";
  imageUrl.mockReset().mockResolvedValue({
    url: "https://example.com/capture.png",
    expiresAtMs: Date.now() + 60_000,
  });
  render(<ToolActivityRow tool={{ ...running, state: "completed", captures: [captureId] }} />);
  expect(imageUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));
  expect(
    (await screen.findByRole("img", { name: "Screenshot saved by Scout" })).getAttribute("src"),
  ).toBe("https://example.com/capture.png");
  expect(imageUrl).toHaveBeenCalledWith({ screenshotId: captureId });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));
  expect(imageUrl).toHaveBeenCalledTimes(1);
});
