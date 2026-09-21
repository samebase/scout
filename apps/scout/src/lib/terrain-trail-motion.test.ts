import { d } from "typegpu";
import { expect, test } from "vite-plus/test";
import {
  advanceTrail,
  createTrailState,
  projectTrailNode,
  resetTrailConnection,
  type TrailView,
} from "./terrain-trail-motion";
import { defaultTerrainSettings } from "./terrain-settings";
import { trailNodesPerLeg, trailSpline } from "./terrain-trail";
import { moveTrailCheckpoint } from "./terrain-trail-drag";

const settings = { ...defaultTerrainSettings, trail: 1 };
const view: TrailView = {
  width: 1100,
  height: 760,
  frameHeight: 480,
  bounds: { left: 0, top: 0, right: 1100, bottom: 480 },
  obstacles: [],
  interacting: false,
};
const timeAt = (checkpoints: number) => ({ checkpoints, terrain: 12, shimmer: 4 });

function expectSmoothJoin(nodes: { x: number; z: number }[], index: number) {
  const p = nodes.slice(index - 2, index + 3).map((point) => d.vec2f(point.x, point.z));
  const a = trailSpline(p[0], p[1], p[2], p[3], 0.999);
  const b = trailSpline(p[1], p[2], p[3], p[4], 0.001);
  const incoming = [p[2].x - a.x, p[2].y - a.y];
  const outgoing = [b.x - p[2].x, b.y - p[2].y];
  expect(
    (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
      (Math.hypot(...incoming) * Math.hypot(...outgoing)),
  ).toBeGreaterThan(0.995);
}

test("reset preserves all four destinations and joins them with continuous headings", () => {
  const state = createTrailState();
  advanceTrail(state, timeAt(0), settings, view);
  moveTrailCheckpoint(state, 1, { x: 1.5, z: -1 });
  moveTrailCheckpoint(state, 2, { x: -1.5, z: 1 });
  const checkpoints = state.homes.map((_, index) => ({ ...state.nodes[index * trailNodesPerLeg] }));
  resetTrailConnection(state, settings);
  for (let index = 0; index < checkpoints.length; index++)
    expect(state.nodes[index * trailNodesPerLeg]).toEqual(checkpoints[index]);
  for (const index of [trailNodesPerLeg, 2 * trailNodesPerLeg])
    expectSmoothJoin(state.nodes, index);
  const reset = structuredClone(state);
  resetTrailConnection(state, settings);
  expect(state).toEqual(reset);
});
function simulate(seconds: number, fps = 24, options = settings, camera = view) {
  const state = createTrailState();
  advanceTrail(state, timeAt(0), options, camera);
  for (let frame = 1; frame <= seconds * fps; frame++)
    advanceTrail(state, timeAt(frame / fps), options, camera);
  return state;
}

test("pauses and camera, framing, or quality changes never relocate or resize the rope", () => {
  const state = simulate(0.125);
  const before = structuredClone(state);
  advanceTrail(
    state,
    timeAt(0.125),
    {
      ...settings,
      tilt: 85,
      rotation: -120,
      zoom: 3,
      quality: "low",
    },
    { ...view, width: 390, frameHeight: 720 },
  );
  expect(state).toEqual(before);
});

test("a new obstruction gradually pushes the rope through velocity, without a position correction", () => {
  const options = { ...settings, checkpointDrift: 0, tilt: 85, offsetX: 0, offsetY: 0 };
  const camera = {
    ...view,
    frameHeight: 760,
    bounds: { left: 0, top: 0, right: 1100, bottom: 760 },
  };
  const state = simulate(0, 24, options, camera);
  const middle = state.nodes[trailNodesPerLeg];
  const projected = projectTrailNode(middle, 12, options, camera);
  const blocked = {
    ...camera,
    obstacles: [
      {
        left: projected.x - 300,
        right: projected.x + 10,
        top: projected.y - 300,
        bottom: projected.y + 300,
      },
    ],
  };
  const original = structuredClone(middle);
  advanceTrail(state, timeAt(0), options, blocked);
  expect(middle).toEqual(original);
  advanceTrail(state, timeAt(1 / 24), options, blocked);
  expect(Math.hypot(middle.x - original.x, middle.z - original.z)).toBeLessThan(0.001);
  for (let frame = 2; frame <= 24; frame++)
    advanceTrail(state, timeAt(frame / 24), options, blocked);
  expect(projectTrailNode(middle, 12, options, blocked).x).toBeGreaterThan(projected.x);
});

test("dragging the camera disables view steering while preserving natural motion", () => {
  const options = { ...settings, checkpointAvoidance: false };
  const withoutSteering = simulate(0.125, 24, options);
  const duringDrag = simulate(0.125, 24, settings, {
    ...view,
    interacting: true,
    obstacles: [{ left: 0, top: 0, right: 1100, bottom: 760 }],
  });
  expect(duringDrag.nodes).toEqual(withoutSteering.nodes);
});

test("switching off checkpoint animation stops both wandering and visibility steering", () => {
  const state = simulate(0.125);
  const options = { ...settings, checkpointMotion: false };
  advanceTrail(state, timeAt(1), options, view);
  const frozen = structuredClone(state.nodes);
  for (const seconds of [2, 10, 20]) {
    advanceTrail(state, timeAt(seconds), options, {
      ...view,
      width: 390,
      bounds: { left: 0, top: 0, right: 390, bottom: 480 },
    });
    expect(state.nodes).toEqual(frozen);
  }
});

test("terrain changes bend the route when checkpoint movement is disabled", () => {
  const options = {
    ...settings,
    checkpointMotion: false,
    checkpointAvoidance: false,
    elevation: 1,
    peaks: 1.5,
  };
  const state = simulate(0, 24, options);
  const before = structuredClone(state.nodes);
  let movement = 0;
  for (const terrain of [12.3, 13, 15, 18]) {
    advanceTrail(state, { checkpoints: 0, terrain, shimmer: 4 }, options, view);
    for (let checkpoint = 0; checkpoint < state.homes.length; checkpoint++) {
      const index = checkpoint * trailNodesPerLeg;
      expect(state.nodes[index]).toEqual(before[index]);
    }
    movement = Math.max(
      movement,
      ...state.nodes.map((node, index) =>
        Math.hypot(node.x - before[index].x, node.z - before[index].z),
      ),
    );
  }
  expect(movement).toBeGreaterThan(0.02);
});
