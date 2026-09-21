import { d } from "typegpu";
import { expect, test } from "vite-plus/test";
import {
  advanceTrail,
  createTrailState,
  projectTrailNode,
  resetTrailConnection,
  type TrailView,
} from "./terrain-trail-motion";
import { inspectTrail } from "./terrain-trail-diagnostics";
import { advanceTrailDisplay } from "./terrain-trail-transition";
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
  const state = simulate(2);
  const before = structuredClone(state);
  advanceTrail(
    state,
    timeAt(2),
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
  const state = simulate(1, 24, options, camera);
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
  advanceTrail(state, timeAt(1), options, blocked);
  expect(middle).toEqual(original);
  advanceTrail(state, timeAt(1 + 1 / 24), options, blocked);
  expect(Math.hypot(middle.x - original.x, middle.z - original.z)).toBeLessThan(0.001);
  for (let frame = 2; frame <= 240; frame++)
    advanceTrail(state, timeAt(1 + frame / 24), options, blocked);
  expect(projectTrailNode(middle, 12, options, blocked).x).toBeGreaterThan(projected.x + 2);
});

test("dragging the camera disables view steering while preserving natural motion", () => {
  const options = { ...settings, checkpointAvoidance: false };
  const withoutSteering = simulate(2, 24, options);
  const duringDrag = simulate(2, 24, settings, {
    ...view,
    interacting: true,
    obstacles: [{ left: 0, top: 0, right: 1100, bottom: 760 }],
  });
  expect(duringDrag.nodes).toEqual(withoutSteering.nodes);
});

test("switching off checkpoint animation stops both wandering and visibility steering", () => {
  const state = simulate(1);
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

test("low frame rates preserve the physical trajectory", () => {
  const options = { ...settings, checkpointAvoidance: false };
  const slow = simulate(20, 12, options);
  const fast = simulate(20, 60, options);
  for (let index = 0; index < slow.nodes.length; index++) {
    expect(slow.nodes[index].x).toBeCloseTo(fast.nodes[index].x, 2);
    expect(slow.nodes[index].z).toBeCloseTo(fast.nodes[index].z, 2);
  }
}, 10000);

test("all four checkpoints move independently while the terrain is frozen", () => {
  const options = { ...settings, checkpointAvoidance: false };
  const initial = simulate(0, 24, options);
  const later = simulate(20, 24, options);
  const movements = later.homes.map((_, index) => {
    const before = initial.nodes[index * trailNodesPerLeg];
    const after = later.nodes[index * trailNodesPerLeg];
    return { x: after.x - before.x, z: after.z - before.z };
  });
  for (const movement of movements)
    expect(Math.hypot(movement.x, movement.z)).toBeGreaterThan(0.05);
  for (const movement of movements.slice(1))
    expect(Math.hypot(movement.x - movements[0].x, movement.z - movements[0].z)).toBeGreaterThan(
      0.1,
    );
});

test("moving checkpoints retain a shared direction without waiting for neighboring controls to catch up", () => {
  const state = createTrailState();
  const options = { ...settings, checkpointAvoidance: false };
  for (let frame = 0; frame <= 8 * 24; frame++) {
    advanceTrail(state, timeAt(frame / 24), options, view);
    for (const index of [trailNodesPerLeg, 2 * trailNodesPerLeg])
      expectSmoothJoin(state.nodes, index);
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

test("stationary checkpoints and terrain have no independent traveling wave", () => {
  const state = simulate(90, 12, { ...settings, checkpointAvoidance: false, checkpointDrift: 0 });
  expect(Math.max(...state.nodes.map((node) => Math.hypot(node.vx, node.vz)))).toBeLessThan(0.002);
}, 10000);

test("the open route stays visible at the user's rotated landing angle", () => {
  const options = {
    ...settings,
    tilt: 25.603125,
    rotation: -52.757617,
    trailWidth: 4.25,
    trailLift: 0.065,
  };
  const camera = {
    ...view,
    width: 949,
    height: 856.453125,
    frameHeight: 576.453125,
    bounds: { left: 0, top: 0, right: 949, bottom: 576.453125 },
    obstacles: [
      { left: 32, top: 32, right: 917, bottom: 152.953125 },
      { left: 32, top: 172.953125, right: 692, bottom: 286.453125 },
      { left: 144.5, top: 338.453125, right: 804.5, bottom: 576.453125 },
    ],
  };
  const state = createTrailState();
  let closest = Infinity;
  let worstOutside = 0;
  for (let frame = 0; frame <= 120 * 8; frame++) {
    const seconds = frame / 8;
    const time = { checkpoints: seconds, terrain: 12 + seconds * 0.3, shimmer: 4 + seconds * 0.1 };
    advanceTrail(state, time, options, camera);
    const first = state.nodes[0];
    const last = state.nodes[state.nodes.length - 1];
    closest = Math.min(closest, Math.hypot(last.x - first.x, last.z - first.z));
    if (seconds < 20 || frame % 2 !== 0) continue;
    advanceTrailDisplay(state, options, 0, false);
    const observed = inspectTrail(state, time.terrain, options, camera, "positions");
    worstOutside = Math.max(worstOutside, ...observed.checkpoints.map((point) => point.outside));
  }
  const length = state.span;
  expect(closest / length).toBeGreaterThan(0.4);
  expect(worstOutside).toBe(0);
}, 30000);

test.each([10, 85])(
  "steep terrain at tilt %s and a narrow viewport keep forces finite and bounded",
  (tilt) => {
    const options = { ...settings, peaks: 2, elevation: 3, tilt, zoom: 3 };
    const camera = {
      ...view,
      width: 390,
      bounds: { left: 0, top: 0, right: 390, bottom: 640 },
      frameHeight: 640,
      obstacles: [{ left: 0, top: 0, right: 390, bottom: 640 }],
    };
    const state = simulate(6, 12, options, camera);
    for (const node of state.nodes) {
      expect(Number.isFinite(node.x + node.z)).toBe(true);
      expect(Math.hypot(node.vx, node.vz)).toBeLessThan(0.82);
    }
  },
);

test("checkpoints stay within the user's landing preview after settling, while the terrain evolves", () => {
  const options = {
    ...settings,
    tilt: 22.028125,
    rotation: -19.682422,
    trailWidth: 4.25,
    trailLift: 0.065,
  };
  const camera = {
    ...view,
    width: 682,
    height: 830.53125,
    frameHeight: 550.53125,
    bounds: { left: 0, top: 0, right: 682, bottom: 550.53125 },
    obstacles: [
      { left: 32, top: 32, right: 650, bottom: 127.03125 },
      { left: 32, top: 147.03125, right: 650, bottom: 260.53125 },
      { left: 32, top: 312.53125, right: 650, bottom: 550.53125 },
    ],
  };
  const state = createTrailState();
  let worstOutside = 0;
  let localMotion = 0;
  let groupMotion = 0;
  for (let frame = 0; frame <= 90 * 8; frame++) {
    const seconds = frame / 8;
    const time = { checkpoints: seconds, terrain: 12 + seconds * 0.3, shimmer: 4 + seconds * 0.1 };
    advanceTrail(state, time, options, camera);
    if (seconds < 20 || frame % 2 !== 0) continue;
    advanceTrailDisplay(state, options, 0, false);
    const observed = inspectTrail(state, time.terrain, options, camera, "positions");
    worstOutside = Math.max(worstOutside, ...observed.checkpoints.map((point) => point.outside));
    localMotion += observed.relativeSpeed;
    groupMotion += observed.meanSpeed;
  }
  expect(worstOutside).toBe(0);
  expect(localMotion).toBeGreaterThan(groupMotion);
}, 30000);

test("a smaller viewport brings escaped checkpoints back gradually without resetting the route", () => {
  const options = {
    ...settings,
    tilt: 22.028125,
    rotation: -19.682422,
    trailWidth: 4.25,
    trailLift: 0.065,
  };
  const state = simulate(10, 24, options);
  const before = structuredClone(state.nodes);
  const span = state.span;
  const narrow = {
    ...view,
    width: 682,
    height: 830.53125,
    frameHeight: 550.53125,
    bounds: { left: 0, top: 0, right: 682, bottom: 550.53125 },
  };
  advanceTrail(state, timeAt(10), options, narrow);
  expect(state.nodes).toEqual(before);
  for (let frame = 1; frame <= 30 * 24; frame++)
    advanceTrail(state, timeAt(10 + frame / 24), options, narrow);
  expect(state.span).toEqual(span);
  advanceTrailDisplay(state, options, 0, false);
  expect(
    inspectTrail(state, 12, options, narrow, "positions").checkpoints.every(
      (point) => point.outside === 0,
    ),
  ).toBe(true);
}, 10000);
