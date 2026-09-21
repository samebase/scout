// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test, vi } from "vite-plus/test";
import { DiscoveryHero } from "./discovery-hero";
import { DiscoveryTerrain } from "./discovery-terrain";
import { atlasTerrainSettings, routeExperimentSettings } from "#lib/terrain-settings";
import { terrainRenderProfiles } from "#lib/terrain-quality";
import { createTerrainAnimation } from "#lib/terrain-motion";
import { advanceTrail, projectTrailNode } from "#lib/terrain-trail-motion";
import { advanceTrailDisplay } from "#lib/terrain-trail-transition";
import { moveTrailCheckpoint } from "#lib/terrain-trail-drag";
import { trailNodesPerLeg } from "#lib/terrain-trail";
import type { createDiscoveryField } from "#lib/discovery-field";

const gpu = vi.hoisted(() => ({
  initialize: vi.fn(),
  draw: vi.fn<NonNullable<Awaited<ReturnType<typeof createDiscoveryField>>>["draw"]>(),
  destroy: vi.fn(),
  submitted: vi.fn(),
}));

vi.mock("#lib/discovery-field", () => ({ createDiscoveryField: gpu.initialize }));

beforeEach(() => {
  vi.stubGlobal("navigator", { gpu: {} });
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  gpu.submitted.mockResolvedValue(undefined);
  gpu.initialize.mockResolvedValue({
    draw: gpu.draw,
    destroy: gpu.destroy,
    device: { lost: new Promise(() => {}), queue: { onSubmittedWorkDone: gpu.submitted } },
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
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).not.toHaveBeenCalled();

  fireEvent.blur(screen.getByRole("textbox", { name: "Message Scout" }));
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.draw).toHaveBeenCalled();
  view.unmount();
  expect(gpu.destroy).toHaveBeenCalledOnce();
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).not.toHaveBeenCalled();
});

test("renders a still frame for reduced motion", async () => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  Object.defineProperty(media, "matches", { value: true });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  await openHero();
  expect(gpu.draw).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).toHaveBeenCalledOnce();
});

test("reveals the real terrain only after its first GPU frame, without showing an unrelated poster", async () => {
  let finishFirstFrame: () => void;
  gpu.submitted.mockReturnValue(
    new Promise<void>((resolve) => {
      finishFirstFrame = resolve;
    }),
  );
  const onStatusChange = vi.fn();
  const view = render(
    <DiscoveryTerrain
      paused
      settings={{ ...atlasTerrainSettings, contrast: 1, zoom: 2 }}
      onStatusChange={onStatusChange}
    />,
  );
  expect(view.container.querySelector("picture")).toBeNull();
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.draw).toHaveBeenCalledOnce();
  expect(view.container.querySelector("picture")).toBeNull();
  expect(view.container.querySelector("canvas")?.className).toContain("opacity-0");
  expect(onStatusChange).not.toHaveBeenCalled();

  await act(async () => finishFirstFrame());
  expect(view.container.querySelector("canvas")?.className).toContain("opacity-100");
  expect(view.container.querySelector("picture")).toBeNull();
  expect(onStatusChange).toHaveBeenCalledWith({ kind: "ready" });
});

test("keeps the headline and static field without WebGPU", async () => {
  vi.stubGlobal("navigator", {});
  const view = await openHero();
  expect(
    screen.getByRole("heading", {
      name: "Check if a product does what you need.",
    }),
  ).toBeTruthy();
  expect(view.container.querySelector("picture")).not.toBeNull();
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
  expect(view.container.querySelector("picture")).not.toBeNull();
  expect(view.container.querySelector("canvas")?.className).toContain("opacity-0");
  expect(gpu.draw).not.toHaveBeenCalled();
});

test("discards initialization that finishes after navigation", async () => {
  gpu.initialize.mockImplementation(() => {
    view.unmount();
    return Promise.resolve({
      draw: gpu.draw,
      destroy: gpu.destroy,
      device: { lost: new Promise(() => {}), queue: { onSubmittedWorkDone: gpu.submitted } },
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
  expect(gpu.draw).toHaveBeenLastCalledWith(
    { terrain: 12, shimmer: 4, checkpoints: 0 },
    changed,
    0,
    expect.objectContaining({ interacting: false }),
  );
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).not.toHaveBeenCalled();
});

test("redraws a reset connection while paused without restarting the renderer or clock", async () => {
  const animationRef = { current: createTerrainAnimation(atlasTerrainSettings) };
  animationRef.current.time = { checkpoints: 8, terrain: 14, shimmer: 9 };
  const view = render(
    <DiscoveryHero
      paused
      settings={atlasTerrainSettings}
      animationRef={animationRef}
      frameRevision={0}
      children={null}
    />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  gpu.draw.mockClear();
  view.rerender(
    <DiscoveryHero
      paused
      settings={atlasTerrainSettings}
      animationRef={animationRef}
      frameRevision={1}
      children={null}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).toHaveBeenCalledOnce();
  expect(gpu.draw.mock.lastCall?.[0]).toEqual({ checkpoints: 8, terrain: 14, shimmer: 9 });
  expect(gpu.initialize).toHaveBeenCalledOnce();
  expect(gpu.destroy).not.toHaveBeenCalled();
});

test("zero speed holds a frame and resumes when speed increases", async () => {
  const view = render(
    <DiscoveryTerrain paused={false} settings={{ ...atlasTerrainSettings, speed: 0 }} />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(gpu.draw).toHaveBeenCalledOnce();
  view.rerender(<DiscoveryTerrain paused={false} settings={atlasTerrainSettings} />);
  await act(() => vi.advanceTimersToNextFrame());
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(48));
  expect(gpu.draw).toHaveBeenCalledTimes(3);
  expect(gpu.draw.mock.lastCall?.[0].shimmer).toBeGreaterThan(4);
});

test.each([true, false])(
  "finishes a reroute with both scene clocks stopped, paused=%s",
  async (paused) => {
    const settings = { ...routeExperimentSettings, peaks: 0, routeMaxSpeed: 1 };
    const animationRef = { current: createTerrainAnimation(settings) };
    const camera = {
      width: 1000,
      height: 700,
      frameHeight: 700,
      bounds: { left: 0, top: 0, right: 1000, bottom: 700 },
      obstacles: [],
      interacting: false,
    };
    gpu.draw.mockImplementation((time, options, _, motion) => {
      advanceTrail(motion.state, time, options, camera);
      advanceTrailDisplay(motion.state, options, motion.elapsed, motion.animateTransition);
    });
    const view = render(
      <DiscoveryTerrain paused={paused} settings={settings} animationRef={animationRef} />,
    );
    await act(() => vi.dynamicImportSettled());
    await act(() => vi.advanceTimersToNextFrame());
    const before = structuredClone(animationRef.current);
    moveTrailCheckpoint(animationRef.current.trail, 0, { x: -3, z: 2 });
    const stretched = structuredClone(animationRef.current.trail.display.nodes);
    expect(stretched[0]).toEqual({ x: -3, z: 2 });
    view.rerender(
      <DiscoveryTerrain
        paused={paused}
        settings={settings}
        animationRef={animationRef}
        frameRevision={1}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(animationRef.current.trail.display.nodes[0]).toEqual({ x: -3, z: 2 });
    expect(animationRef.current.trail.display.nodes).not.toEqual(stretched);
    expect(animationRef.current.time).toEqual(before.time);
    expect(animationRef.current.trail.display.moving).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(animationRef.current.trail.display.nodes[0]).toEqual({ x: -3, z: 2 });
    expect(animationRef.current.trail.display.moving).toBe(false);
    expect(animationRef.current.time).toEqual(before.time);
    gpu.draw.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(gpu.draw).not.toHaveBeenCalled();
  },
);

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

test.each([true, false])(
  "drags a checkpoint without rotating the camera, paused=%s",
  async (paused) => {
    const settings = { ...atlasTerrainSettings, trail: 1 };
    const animationRef = { current: createTerrainAnimation(settings) };
    const camera = {
      width: 1100,
      height: 760,
      frameHeight: 760,
      bounds: { left: 0, top: 0, right: 1100, bottom: 760 },
      obstacles: [],
      interacting: false,
    };
    advanceTrail(animationRef.current.trail, animationRef.current.time, settings, camera);
    const onCameraChange = vi.fn();
    const view = render(
      <DiscoveryTerrain
        paused={paused}
        settings={settings}
        animationRef={animationRef}
        onCameraChange={onCameraChange}
      />,
    );
    await act(() => vi.dynamicImportSettled());
    await act(() => vi.advanceTimersToNextFrame());
    const canvas = view.container.querySelector("canvas");
    assert.isNotNull(canvas);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 1100, 760));
    vi.spyOn(canvas, "clientHeight", "get").mockReturnValue(760);
    canvas.setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    canvas.releasePointerCapture = releasePointerCapture;
    const point = animationRef.current.trail.nodes[trailNodesPerLeg];
    const screen = projectTrailNode(point, animationRef.current.time.terrain, settings, camera);
    const frozen = { ...animationRef.current.time };
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: screen.x + 17,
      clientY: screen.y + 24,
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(animationRef.current.time).toEqual(frozen);
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: screen.x + 47, clientY: screen.y + 39 });
    await act(() => vi.advanceTimersToNextFrame());
    const moved = projectTrailNode(
      animationRef.current.trail.display.nodes[trailNodesPerLeg],
      animationRef.current.time.terrain,
      settings,
      camera,
    );
    expect(moved.x).toBeCloseTo(screen.x + 30, 1);
    expect(moved.y).toBeCloseTo(screen.y + 15, 1);
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(gpu.draw.mock.lastCall?.[3].interacting).toBe(true);
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    await act(() => vi.advanceTimersByTimeAsync(200));
    if (paused) expect(animationRef.current.time).toEqual(frozen);
    else expect(animationRef.current.time.checkpoints).toBeGreaterThan(frozen.checkpoints);
    expect(gpu.initialize).toHaveBeenCalledOnce();
  },
);

test("automatic quality limits work on touch devices and keeps animation time when quality changes", async () => {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = matchMedia(query);
    if (query.includes("pointer: coarse")) Object.defineProperty(media, "matches", { value: true });
    return media;
  });
  const settings = { ...atlasTerrainSettings, speed: 1 };
  const view = render(<DiscoveryTerrain paused={false} settings={settings} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.initialize.mock.lastCall?.[2]).toEqual(terrainRenderProfiles.low);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(192));
  expect(gpu.draw.mock.calls.length).toBeGreaterThanOrEqual(10);
  expect(gpu.draw.mock.calls.length).toBeLessThanOrEqual(12);
  const rope = gpu.draw.mock.lastCall?.[3].state;
  const elapsedTime = gpu.draw.mock.lastCall?.[0].shimmer;
  assert.isDefined(elapsedTime);
  expect(elapsedTime).toBeGreaterThan(4.1);

  view.rerender(<DiscoveryTerrain paused={false} settings={{ ...settings, quality: "high" }} />);
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.destroy).toHaveBeenCalledOnce();
  expect(gpu.initialize.mock.lastCall?.[2]).toEqual(terrainRenderProfiles.high);
  expect(gpu.draw.mock.lastCall?.[0].shimmer).toBeGreaterThanOrEqual(elapsedTime);
  expect(gpu.draw.mock.lastCall?.[3].state).toBe(rope);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(192));
  expect(gpu.draw.mock.calls.length).toBeGreaterThanOrEqual(10);
  expect(gpu.draw.mock.calls.length).toBeLessThanOrEqual(12);
});

test("the landing and terrain previews can share the same rope and animation clocks", async () => {
  const animationRef = { current: createTerrainAnimation(atlasTerrainSettings) };
  animationRef.current.time = { terrain: 25, shimmer: 12, checkpoints: 42 };
  const view = render(
    <DiscoveryTerrain paused settings={atlasTerrainSettings} animationRef={animationRef} />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  const rope = gpu.draw.mock.lastCall?.[3].state;
  view.rerender(
    <DiscoveryHero
      paused
      settings={atlasTerrainSettings}
      animationRef={animationRef}
      children={null}
    />,
  );
  await act(() => vi.dynamicImportSettled());
  await act(() => vi.advanceTimersToNextFrame());
  expect(gpu.draw.mock.lastCall?.[0]).toEqual({ terrain: 25, shimmer: 12, checkpoints: 42 });
  expect(gpu.draw.mock.lastCall?.[3].state).toBe(rope);
});

test("visibility steering uses the real content bounds relative to the canvas", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.tagName === "CANVAS"
        ? new DOMRect(10, 20, 1100, 760)
        : new DOMRect(40, 90, 660, 120);
    },
  );
  await openHero();
  expect(gpu.draw.mock.lastCall?.[3].obstacles).toEqual([
    { left: 30, top: 70, right: 690, bottom: 190 },
    { left: 30, top: 70, right: 690, bottom: 190 },
    { left: 30, top: 70, right: 690, bottom: 190 },
  ]);
});

test("waits for a busy GPU instead of accumulating frames, then resumes rendering", async () => {
  await openHero();
  let releaseGpu: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseGpu = resolve;
  });
  gpu.submitted.mockReturnValue(pending);
  gpu.draw.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(gpu.draw).toHaveBeenCalledTimes(2);
  await act(async () => releaseGpu());
  await act(() => vi.advanceTimersByTimeAsync(64));
  expect(gpu.draw.mock.calls.length).toBeGreaterThan(2);
});
