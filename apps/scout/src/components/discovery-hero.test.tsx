// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { DiscoveryHero } from "./discovery-hero";
import { DiscoveryTerrain } from "./discovery-terrain";
import { atlasTerrainSettings } from "#lib/terrain-settings";
import { terrainRenderProfiles } from "#lib/terrain-quality";

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
  const view = render(
    <DiscoveryHero paused={false} settings={atlasTerrainSettings}>
      <textarea aria-label="Message Scout" />
    </DiscoveryHero>,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  return view;
}

test("pauses while composing and releases GPU resources when leaving the page", async () => {
  const view = await openHero();
  expect(gpu.draw).toHaveBeenCalled();
  fireEvent.focus(screen.getByRole("textbox", { name: "Message Scout" }));
  await act(() => vi.advanceTimersToNextFrame());
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).not.toHaveBeenCalled();

  fireEvent.blur(screen.getByRole("textbox", { name: "Message Scout" }));
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
  const view = await openHero();
  expect(screen.getByRole("heading", { name: "See what lies beneath the pitch." })).toBeTruthy();
  expect(view.container.querySelector("picture")?.className).toContain("opacity-100");
  expect(view.container.querySelector("picture img")?.getAttribute("src")).toBe(
    "/discovery-terrain.webp",
  );
  expect(gpu.initialize).not.toHaveBeenCalled();
  expect(screen.queryByRole("button")).toBeNull();
});

test("keeps the terrain poster visible when GPU setup fails", async () => {
  gpu.initialize.mockRejectedValue(new Error("WebGPU unavailable"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const view = await openHero();
  expect(view.container.querySelector("picture")?.className).toContain("opacity-100");
  expect(view.container.querySelector("canvas")?.className).toContain("opacity-0");
  expect(gpu.draw).not.toHaveBeenCalled();
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
  const view = render(
    <DiscoveryHero paused={false} settings={atlasTerrainSettings} children={null} />,
  );
  await act(() => vi.dynamicImportSettled());
  expect(gpu.draw).not.toHaveBeenCalled();
  expect(gpu.destroy).toHaveBeenCalledOnce();
});

test("updates a paused preview without rebuilding the GPU or advancing its animation", async () => {
  const view = render(<DiscoveryTerrain paused settings={atlasTerrainSettings} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  const changed = { ...atlasTerrainSettings, tilt: 76, zoom: 2, extent: 2.5 };
  view.rerender(<DiscoveryTerrain paused settings={changed} />);
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.initialize).toHaveBeenCalledOnce();
  expect(gpu.destroy).not.toHaveBeenCalled();
  expect(gpu.draw).toHaveBeenLastCalledWith(4, changed);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).not.toHaveBeenCalled();
});

test("zero speed holds a frame and resumes when speed increases", async () => {
  const view = render(
    <DiscoveryTerrain paused={false} settings={{ ...atlasTerrainSettings, speed: 0 }} />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  await act(() => vi.advanceTimersByTime(200));
  expect(gpu.draw).toHaveBeenCalledOnce();
  view.rerender(<DiscoveryTerrain paused={false} settings={atlasTerrainSettings} />);
  await act(() => vi.advanceTimersToNextFrame());
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.draw).toHaveBeenCalledOnce();
  expect(gpu.draw.mock.lastCall?.[0]).toBeGreaterThan(4);
});

test("moves the camera only during a captured drag, including when animation is paused", async () => {
  const onCameraChange = vi.fn();
  const view = render(
    <DiscoveryTerrain
      paused
      settings={{ ...atlasTerrainSettings, tilt: 58, rotation: -12 }}
      onCameraChange={onCameraChange}
    />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  const canvas = view.container.querySelector("canvas")!;
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  canvas.setPointerCapture = setPointerCapture;
  canvas.releasePointerCapture = releasePointerCapture;
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 300 });
  expect(onCameraChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 300, clientY: 300 });
  expect(setPointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 420, clientY: 330 });
  expect(onCameraChange).toHaveBeenLastCalledWith(64, -42);
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 300 });
  expect(onCameraChange).toHaveBeenLastCalledWith(58, 18);
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  expect(releasePointerCapture).toHaveBeenCalledWith(1);
  onCameraChange.mockClear();
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 600, clientY: 100 });
  expect(onCameraChange).not.toHaveBeenCalled();
  expect(gpu.initialize).toHaveBeenCalledOnce();
});

test("automatic quality limits work on touch devices and keeps animation time when quality changes", async () => {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = matchMedia(query);
    if (query.includes("pointer: coarse")) Object.defineProperty(media, "matches", { value: true });
    return media;
  });
  const settings = { ...atlasTerrainSettings, speed: 3.5 };
  const view = render(<DiscoveryTerrain paused={false} settings={settings} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.initialize.mock.lastCall?.[2]).toEqual(terrainRenderProfiles.low);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(192));
  expect(gpu.draw.mock.calls.length).toBeGreaterThanOrEqual(5);
  expect(gpu.draw.mock.calls.length).toBeLessThanOrEqual(7);
  const elapsedTime = gpu.draw.mock.lastCall?.[0];
  expect(elapsedTime).toBeGreaterThan(4.5);

  view.rerender(<DiscoveryTerrain paused={false} settings={{ ...settings, quality: "high" }} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.destroy).toHaveBeenCalledOnce();
  expect(gpu.initialize.mock.lastCall?.[2]).toEqual(terrainRenderProfiles.high);
  expect(gpu.draw.mock.lastCall?.[0]).toBeGreaterThanOrEqual(elapsedTime);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTime(192));
  expect(gpu.draw.mock.calls.length).toBeGreaterThanOrEqual(10);
});
