// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { DiscoveryHero } from "./discovery-hero";

const gpu = vi.hoisted(() => ({
  initialize: vi.fn(),
  draw: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("#lib/discovery-field", () => ({ createDiscoveryField: gpu.initialize }));

beforeEach(() => {
  vi.stubGlobal("navigator", { gpu: {} });
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  gpu.initialize.mockResolvedValue({
    draw: gpu.draw,
    destroy: gpu.destroy,
    device: { lost: new Promise(() => {}) },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function openHero() {
  const view = render(<DiscoveryHero composing={false} children={null} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  return view;
}

test("pauses while composing and releases GPU resources when leaving the page", async () => {
  const view = await openHero();
  expect(gpu.draw).toHaveBeenCalled();
  view.rerender(<DiscoveryHero composing children={null} />);
  await act(() => vi.advanceTimersToNextFrame());
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).not.toHaveBeenCalled();

  view.rerender(<DiscoveryHero composing={false} children={null} />);
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.draw).toHaveBeenCalled();
  view.unmount();
  expect(gpu.destroy).toHaveBeenCalledOnce();
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).not.toHaveBeenCalled();
});

test("renders a still frame for reduced motion", async () => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  Object.defineProperty(media, "matches", { value: true });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  await openHero();
  expect(gpu.draw).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button")).toBeNull();
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).toHaveBeenCalledOnce();
});

test("keeps the headline and static field without WebGPU", async () => {
  vi.stubGlobal("navigator", {});
  await openHero();
  expect(screen.getByRole("heading", { name: "See what lies beneath the pitch." })).toBeTruthy();
  expect(gpu.initialize).not.toHaveBeenCalled();
  expect(screen.queryByRole("button")).toBeNull();
});

test("discards initialization that finishes after navigation", async () => {
  gpu.initialize.mockImplementation(() => {
    view.unmount();
    return Promise.resolve({
      draw: gpu.draw,
      destroy: gpu.destroy,
      device: { lost: new Promise(() => {}) },
    });
  });
  const view = render(<DiscoveryHero composing={false} children={null} />);
  await act(() => vi.dynamicImportSettled());
  expect(gpu.draw).not.toHaveBeenCalled();
  expect(gpu.destroy).toHaveBeenCalledOnce();
});
