import { expect, test } from "vite-plus/test";
import { routeExperimentSettings, defaultTerrainSettings } from "./terrain-settings";
import { advanceTrail, createTrailState, resetTrailConnection } from "./terrain-trail-motion";
import { moveTrailCheckpoint } from "./terrain-trail-drag";
import { inspectTrail } from "./terrain-trail-diagnostics";
import { trailNodesPerLeg } from "./terrain-trail";
import { advanceTrailDisplay } from "./terrain-trail-transition";

const view = {
  width: 992,
  height: 600,
  frameHeight: 600,
  bounds: { left: 0, top: 0, right: 992, bottom: 600 },
  obstacles: [],
  interacting: false,
};

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
