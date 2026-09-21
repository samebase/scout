import { d } from "typegpu";
import { expect, test } from "vite-plus/test";
import { terrainHeight } from "./discovery-terrain";
import {
  routeExperimentSettings,
  defaultTerrainSettings,
  terrainSceneIndex,
  type TerrainSettings,
} from "./terrain-settings";
import { advanceTrail, createTrailState, resetTrailConnection } from "./terrain-trail-motion";
import { moveTrailCheckpoint } from "./terrain-trail-drag";
import { inspectTrail } from "./terrain-trail-diagnostics";
import { trailSpline, trailNodesPerLeg } from "./terrain-trail";
import { advanceTrailDisplay } from "./terrain-trail-transition";

const view = {
  width: 992,
  height: 600,
  frameHeight: 600,
  bounds: { left: 0, top: 0, right: 992, bottom: 600 },
  obstacles: [],
  interacting: false,
};

test("the first visible frame already contains a planned detour", () => {
  const state = createTrailState();
  advanceTrail(state, { checkpoints: 0, terrain: 12, shimmer: 0 }, routeExperimentSettings, view);
  const observed = inspectTrail(state, 12, routeExperimentSettings, view, "surface");
  if (observed.climb === null) throw new Error("The experiment must report climb measurements");
  expect(observed.climb.route).toBeLessThan(observed.climb.direct * 0.3);
});

test.each([routeExperimentSettings, { ...defaultTerrainSettings, trail: 1 }])(
  "$scene dragging solves a new curve on the next paused frame (reduced motion)",
  (settings) => {
    const state = createTrailState();
    const time = { checkpoints: 0, terrain: 12, shimmer: 0 };
    advanceTrail(state, time, settings, view);
    const position = { x: state.nodes[0].x + 0.3, z: state.nodes[0].z + 0.2 };
    moveTrailCheckpoint(state, 0, position);
    const checkpoints = state.homes.map((_, index) => ({
      ...state.nodes[index * trailNodesPerLeg],
    }));
    resetTrailConnection(state, settings);
    advanceTrailDisplay(state, settings, 0, false);
    const direct = inspectTrail(state, time.terrain, settings, view, "surface");
    // Even a tiny pointer move must schedule a full solve without starting playback.
    moveTrailCheckpoint(state, 0, { x: position.x + 0.001, z: position.z });
    advanceTrail(state, time, settings, { ...view, interacting: true });
    advanceTrailDisplay(state, settings, 0, false);
    const planned = inspectTrail(state, time.terrain, settings, view, "surface");
    if (!planned.climb || !direct.climb) throw new Error("Missing surface measurements");
    expect(planned.climb.route).toBeLessThan(direct.climb.route * 0.85);
    expect(state.nodes[0]).toMatchObject({ x: position.x + 0.001, z: position.z });
    for (let checkpoint = 1; checkpoint < checkpoints.length; checkpoint++)
      expect(state.nodes[checkpoint * trailNodesPerLeg]).toEqual(checkpoints[checkpoint]);
    expect(state.time).toBe(0);
    const solved = structuredClone(state);
    advanceTrail(state, time, settings, view);
    expect(state).toEqual(solved);
  },
);

test("raising a peak recalculates the route while playback is paused", () => {
  const state = createTrailState();
  const time = { checkpoints: 0, terrain: 12, shimmer: 0 };
  advanceTrail(state, time, { ...routeExperimentSettings, peaks: 0 }, view);
  expect(state.nodes.every((node) => Math.abs(node.z) < 0.001)).toBe(true);
  advanceTrail(state, time, routeExperimentSettings, view);
  advanceTrailDisplay(state, routeExperimentSettings, 0, false);
  const observed = inspectTrail(state, 12, routeExperimentSettings, view, "surface");
  if (!observed.climb) throw new Error("Missing surface measurements");
  expect(observed.climb.route).toBeLessThan(observed.climb.direct * 0.3);
  expect(state.time).toBe(0);
});

test("dragged endpoints stay fixed even when placed close together", () => {
  const state = createTrailState();
  advanceTrail(state, { checkpoints: 0, terrain: 12, shimmer: 0 }, routeExperimentSettings, view);
  moveTrailCheckpoint(state, 0, { x: 1, z: 0 });
  moveTrailCheckpoint(state, 1, { x: 2, z: 0 });
  for (let frame = 1; frame <= 6 * 24; frame++)
    advanceTrail(
      state,
      { checkpoints: frame / 24, terrain: 12, shimmer: 0 },
      routeExperimentSettings,
      view,
    );
  expect(state.nodes[0]).toMatchObject({ x: 1, z: 0 });
  expect(state.nodes.at(-1)).toMatchObject({ x: 2, z: 0 });
});

test("reset connects the current dragged endpoints directly without rewinding the scene", () => {
  const state = createTrailState();
  const time = { checkpoints: 8, terrain: 12, shimmer: 0 };
  advanceTrail(state, time, routeExperimentSettings, view);
  moveTrailCheckpoint(state, 0, { x: -2, z: 0.4 });
  moveTrailCheckpoint(state, 1, { x: 2, z: -0.2 });
  const before = structuredClone(state);
  resetTrailConnection(state, routeExperimentSettings);
  expect(state.time).toBe(before.time);
  expect(state.homes).toEqual(before.homes);
  expect(state.nodes[0]).toEqual(before.nodes[0]);
  expect(state.nodes.at(-1)).toEqual(before.nodes.at(-1));
  for (const point of state.nodes) {
    expect((point.x + 2) * -0.6 - (point.z - 0.4) * 4).toBeCloseTo(0, 5);
    expect(point.vx).toBe(0);
    expect(point.vz).toBe(0);
  }
  const reset = structuredClone(state);
  advanceTrail(state, time, routeExperimentSettings, view);
  expect(state).toEqual(reset);
});

test("fixed checkpoints and terrain leave the entire route unchanged, with no settling", () => {
  const options = { ...defaultTerrainSettings, trail: 1, checkpointMotion: false };
  const state = createTrailState();
  advanceTrail(state, { checkpoints: 0, terrain: 12, shimmer: 0 }, options, view);
  const original = structuredClone(state.nodes);
  for (const seconds of [1, 5, 30]) {
    advanceTrail(state, { checkpoints: seconds, terrain: 12, shimmer: seconds }, options, {
      ...view,
      obstacles: [{ left: 0, top: 0, right: 992, bottom: 600 }],
    });
    expect(state.nodes).toEqual(original);
  }
});

test("terrain updates reroute immediately with checkpoint animation switched off", () => {
  const options = { ...defaultTerrainSettings, trail: 1, checkpointMotion: false };
  const state = createTrailState();
  advanceTrail(state, { checkpoints: 0, terrain: 12, shimmer: 0 }, options, view);
  const original = structuredClone(state.nodes);
  advanceTrail(state, { checkpoints: 0, terrain: 16, shimmer: 0 }, options, view);
  expect(state.nodes).not.toEqual(original);
  for (let i = 0; i < state.nodes.length; i += trailNodesPerLeg)
    expect(state.nodes[i]).toEqual(original[i]);
  const solved = structuredClone(state.nodes);
  advanceTrail(state, { checkpoints: 0, terrain: 16, shimmer: 0 }, options, view);
  expect(state.nodes).toEqual(solved);
});

test.each(["one-hill", "two-hills"] satisfies TerrainSettings["scene"][])(
  "%s emerging hills keep both endpoints fixed and deflect the rendered curve into a lower pass",
  (scene) => {
    const options = { ...routeExperimentSettings, scene, peaks: 0 };
    const state = createTrailState();
    for (let frame = 0; frame <= 24 * 5; frame++)
      advanceTrail(state, { checkpoints: frame / 24, terrain: 12, shimmer: 0 }, options, view);
    expect(state.homes).toEqual([
      { x: -3, z: 0 },
      { x: 3, z: 0 },
    ]);
    expect(state.nodes).toHaveLength(trailNodesPerLeg + 1);
    expect(state.nodes.every((node) => Math.abs(node.z) < 0.001)).toBe(true);
    options.peaks = 1;
    for (let frame = 24 * 5 + 1; frame <= 24 * 20; frame++) {
      advanceTrail(state, { checkpoints: frame / 24, terrain: 12, shimmer: 0 }, options, view);
      advanceTrailDisplay(state, options, 1 / 24, true);
    }
    expect(state.nodes[0]).toMatchObject(state.homes[0]);
    expect(state.nodes.at(-1)).toMatchObject(state.homes[1]);
    const observed = inspectTrail(state, 12, options, view, "surface");
    expect(observed.checkpoints).toHaveLength(2);
    if (observed.climb === null) throw new Error("The experiment must report climb measurements");
    expect(observed.climb.route).toBeLessThan(observed.climb.direct * 0.5);
    const controls = state.nodes.map((node) => d.vec2f(node.x, node.z));
    let highest = 0;
    for (let sample = 0; sample <= 288; sample++) {
      const progress = (sample / 288) * (controls.length - 1);
      const segment = Math.min(Math.floor(progress), controls.length - 2);
      const position = trailSpline(
        controls[Math.max(0, segment - 1)],
        controls[segment],
        controls[segment + 1],
        controls[Math.min(controls.length - 1, segment + 2)],
        progress - segment,
      );
      highest = Math.max(
        highest,
        terrainHeight(
          position.x,
          position.y,
          12,
          options.peaks,
          options.extent,
          terrainSceneIndex[scene],
        ),
      );
    }
    expect(highest).toBeLessThan(0.17 + 1.6 * 0.5);
    const other = { ...state.nodes[trailNodesPerLeg] };
    moveTrailCheckpoint(state, 0, { x: -2, z: 1 });
    expect(state.homes[0]).toEqual({ x: -2, z: 1 });
    expect(state.nodes[trailNodesPerLeg]).toEqual(other);
  },
);
