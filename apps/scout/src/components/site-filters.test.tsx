// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SiteFilters } from "./site-filters";

vi.mock("../lib/access", () => ({ useViewerAccess: () => ({ kind: "anonymous" }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("typing waits for a pause and clearing cancels a pending search", () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(
    <SiteFilters
      search={{ scope: "public" }}
      layout="sidebar"
      reviewedSiteCount={undefined}
      onPendingChange={vi.fn()}
      onChange={onChange}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Filter by site" });
  fireEvent.change(input, { target: { value: "pi" } });
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Pika" } });
  act(() => {
    vi.advanceTimersByTime(299);
  });
  expect(onChange).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(
    { scope: "public", site: "pika" },
    { replace: true },
  );
  onChange.mockClear();
  fireEvent.change(input, { target: { value: "Excalidraw" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear site filter" }));
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(
    { scope: "public", site: undefined },
    { replace: true },
  );
  expect(input).toHaveProperty("value", "");
  expect(screen.queryByRole("button", { name: "Apply site filter" })).toBeNull();
});

test("history navigation and unmount cancel stale search updates", () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const { rerender, unmount } = render(
    <SiteFilters
      search={{ scope: "public", site: "pika" }}
      layout="sidebar"
      reviewedSiteCount={undefined}
      onPendingChange={vi.fn()}
      onChange={onChange}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Filter by site" });
  fireEvent.change(input, { target: { value: "excalidraw" } });
  act(() => {
    vi.advanceTimersByTime(200);
  });
  rerender(
    <SiteFilters
      search={{ scope: "public", site: "studio" }}
      layout="sidebar"
      reviewedSiteCount={undefined}
      onPendingChange={vi.fn()}
      onChange={onChange}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(input).toHaveProperty("value", "studio");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "pika" } });
  unmount();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(onChange).not.toHaveBeenCalled();
});
