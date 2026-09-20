// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { useLocalStorageSidebarState } from "./scoutSidebarState";

const defaults = {
  leftDesktopOpen: true,
  leftDesktopWidthPx: 240,
  leftMobileWidthPx: 280,
  mobilePane: "main",
  mobileSurface: { kind: "unmerged" },
  rightDesktopOpen: true,
  rightDesktopWidthPx: 480,
  rightMobileWidthPx: 480,
} satisfies SidebarLayoutState;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("restores desktop and mobile state while keeping layouts independent", () => {
  const saved: SidebarLayoutState = {
    leftDesktopOpen: false,
    leftDesktopWidthPx: 360,
    leftMobileWidthPx: 320,
    mobilePane: "right",
    mobileSurface: { kind: "merged", side: "right", mainWidthPx: 240 },
    rightDesktopOpen: true,
    rightDesktopWidthPx: 640,
    rightMobileWidthPx: 420,
  };
  const first = renderHook(() =>
    useLocalStorageSidebarState({ defaults, storageKey: "conversation" }),
  );
  act(() => first.result.current.setState(() => saved, "immediate"));
  first.unmount();

  const restored = renderHook(() =>
    useLocalStorageSidebarState({ defaults, storageKey: "conversation" }),
  );
  const separate = renderHook(() => useLocalStorageSidebarState({ defaults, storageKey: "site" }));
  expect(restored.result.current.state).toEqual(saved);
  expect(separate.result.current.state).toEqual(defaults);
});

test("coalesces drag updates and saves the latest width before leaving the page", () => {
  const { result } = renderHook(() =>
    useLocalStorageSidebarState({ defaults, storageKey: "conversation" }),
  );
  for (const width of [300, 320, 340]) {
    act(() => {
      result.current.setState(
        (state) => ({ ...state, leftDesktopWidthPx: width }),
        "width_deferred",
      );
      vi.advanceTimersByTime(100);
    });
    expect(window.localStorage.getItem("conversation")).toBeNull();
  }
  act(() => {
    vi.advanceTimersByTime(60);
  });
  expect(JSON.parse(window.localStorage.getItem("conversation") ?? "null")).toMatchObject({
    state: { leftDesktopWidthPx: 340 },
  });

  act(() => {
    result.current.setState((state) => ({ ...state, rightMobileWidthPx: 520 }), "width_deferred");
    window.dispatchEvent(new Event("pagehide"));
  });
  const restored = renderHook(() =>
    useLocalStorageSidebarState({ defaults, storageKey: "conversation" }),
  );
  expect(restored.result.current.state.rightMobileWidthPx).toBe(520);
});

test("flushes a pending resize to its original key when switching layouts", () => {
  const { result, rerender } = renderHook(
    ({ storageKey }) => useLocalStorageSidebarState({ defaults, storageKey }),
    { initialProps: { storageKey: "conversation" } },
  );
  act(() =>
    result.current.setState((state) => ({ ...state, leftDesktopWidthPx: 360 }), "width_deferred"),
  );
  rerender({ storageKey: "site" });
  expect(result.current.state).toEqual(defaults);
  expect(window.localStorage.getItem("site")).toBeNull();
  rerender({ storageKey: "conversation" });
  expect(result.current.state.leftDesktopWidthPx).toBe(360);
});

test.each([
  { version: 1, state: defaults },
  { version: 2, state: { ...defaults, leftDesktopWidthPx: "wide" } },
  { version: 2, state: { ...defaults, mobileSurface: { kind: "merged", side: "right" } } },
])("ignores incompatible or invalid saved layouts: %j", (stored) => {
  window.localStorage.setItem("conversation", JSON.stringify(stored));
  const { result } = renderHook(() =>
    useLocalStorageSidebarState({ defaults, storageKey: "conversation" }),
  );
  expect(result.current.state).toEqual(defaults);
});
