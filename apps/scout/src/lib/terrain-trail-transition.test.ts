import { d } from "typegpu";
import { expect, test } from "vite-plus/test";
import {
  routeExperimentSettings,
  atlasTerrainSettings,
  terrainSceneIndex,
  type TerrainSettings,
} from "./terrain-settings";
import {
  advanceTrail,
  createTrailState,
  resetTrailConnection,
  projectTrailNode,
  type TrailState,
} from "./terrain-trail-motion";
import { moveTrailCheckpoint, pickTrailCheckpoint } from "./terrain-trail-drag";
import { advanceTrailDisplay } from "./terrain-trail-transition";
import { trailPoint, trailSegments, trailSpline } from "./terrain-trail";
import { trailNodesPerLeg } from "./terrain-trail";
import { terrainHeight } from "./discovery-terrain";

const view = {
  width: 1000,
  height: 700,
  frameHeight: 700,
  bounds: { left: 0, top: 0, right: 1000, bottom: 700 },
  obstacles: [],
  interacting: false,
};
const time = { terrain: 12, checkpoints: 0, shimmer: 4 };

// Sample the actual rendered spline, not just its much sparser control points.
function rendered(state: TrailState, settings: TerrainSettings) {
  const controls = state.display.nodes.map((p) => d.vec2f(p.x, p.z));
  return Array.from({ length: trailSegments + 1 }, (_, index) => {
    const progress = (index / trailSegments) * (controls.length - 1);
    const segment = Math.min(Math.floor(progress), controls.length - 2);
    const position = trailSpline(
      controls[Math.max(0, segment - 1)],
      controls[segment],
      controls[segment + 1],
      controls[Math.min(controls.length - 1, segment + 2)],
      progress - segment,
    );
    const point = trailPoint(
      position,
      state.terrainTime,
      settings.peaks,
      settings.extent,
      settings.elevation,
      settings.trailLift,
      terrainSceneIndex[settings.scene],
    );
    return { x: point.x * settings.spread, y: point.y, z: point.z * settings.depth };
  });
}

test.each([15, 60])(
  "a large reroute caps every rendered vertex's horizontal speed at %s fps",
  (fps) => {
    const settings = { ...routeExperimentSettings, peaks: 2, elevation: 2, routeMaxSpeed: 1.5 };
    const state = createTrailState();
    advanceTrail(state, time, settings, view);
    resetTrailConnection(state, settings);
    advanceTrailDisplay(state, settings, 0, false);
    const initial = rendered(state, settings);
    state.replan = true;
    advanceTrail(state, time, settings, view);
    expect(rendered(state, settings)).toEqual(initial);
    let before = initial;
    let maximum = 0;
    let frames = 0;
    do {
      advanceTrailDisplay(state, settings, 1 / fps, true);
      const after = rendered(state, settings);
      for (let index = 0; index < after.length; index++) {
        const speed =
          Math.hypot(after[index].x - before[index].x, after[index].z - before[index].z) * fps;
        expect(speed).toBeLessThanOrEqual(settings.routeMaxSpeed + 0.0001);
        maximum = Math.max(maximum, speed);
      }
      before = after;
      frames++;
    } while (state.display.moving && frames < fps * 25);
    expect(maximum).toBeGreaterThan(settings.routeMaxSpeed * 0.9);
    expect(frames).toBeGreaterThan(fps);
    expect(state.display.moving).toBe(false);
    expect(state.display.nodes).toEqual(state.nodes.map(({ x, z }) => ({ x, z })));
    const settled = structuredClone(state.display);
    advanceTrailDisplay(state, settings, 1, true);
    expect(state.display).toEqual(settled);
  },
);

test("dragging pins the checkpoint immediately while the stretched line settles at the speed limit", () => {
  const settings = { ...routeExperimentSettings, peaks: 0, routeMaxSpeed: 1 };
  const state = createTrailState();
  advanceTrail(state, time, settings, view);
  for (const destination of [
    { x: -3, z: 3 },
    { x: 2, z: -2 },
  ]) {
    const previous = structuredClone(state.display.nodes);
    moveTrailCheckpoint(state, 0, destination);
    const displayed = structuredClone(state.display.nodes);
    expect(displayed[0]).toEqual(destination);
    expect(displayed.at(-1)).toEqual(previous.at(-1));
    const before = rendered(state, settings);
    advanceTrail(state, time, settings, view);
    expect(state.display.nodes).toEqual(displayed);
    expect(state.nodes[0]).toMatchObject(destination);
    expect(state.display.nodes).not.toEqual(state.nodes.map(({ x, z }) => ({ x, z })));
    advanceTrailDisplay(state, settings, 1 / 60, true);
    expect(state.display.nodes[0]).toEqual(destination);
    const after = rendered(state, settings);
    for (let index = 0; index < after.length; index++)
      expect(
        Math.hypot(after[index].x - before[index].x, after[index].z - before[index].z),
      ).toBeLessThanOrEqual(1 / 60 + 0.00001);
    expect(state.display.moving).toBe(true);
  }
  // The marker can be grabbed again at the cursor while the line is settling.
  const projected = projectTrailNode(state.display.nodes[0], 12, settings, view);
  expect(pickTrailCheckpoint(state, projected, 12, settings, view)?.checkpoint).toBe(0);
});

test("the same speed covers the same ground at different frame rates; stalls do not catch up", () => {
  const settings = { ...routeExperimentSettings, peaks: 0, routeMaxSpeed: 1 };
  const simulate = (fps: number) => {
    const state = createTrailState();
    advanceTrail(state, time, settings, view);
    moveTrailCheckpoint(state, 0, { x: -3, z: 4 });
    advanceTrail(state, time, settings, view);
    for (let frame = 0; frame < fps; frame++) advanceTrailDisplay(state, settings, 1 / fps, true);
    return state;
  };
  const slow = simulate(15);
  const fast = simulate(60);
  slow.display.nodes.forEach((p, index) => {
    expect(p.x).toBeCloseTo(fast.display.nodes[index].x, 3);
    expect(p.z).toBeCloseTo(fast.display.nodes[index].z, 3);
  });
  const before = rendered(fast, settings);
  advanceTrailDisplay(fast, settings, 30, true);
  const after = rendered(fast, settings);
  after.forEach((p, index) =>
    expect(Math.hypot(p.x - before[index].x, p.z - before[index].z)).toBeLessThanOrEqual(0.10001),
  );
});

test("rising and falling ground updates height immediately while the horizontal reroute is still slow", () => {
  const settings = { ...routeExperimentSettings, peaks: 0, elevation: 2, routeMaxSpeed: 0.1 };
  const state = createTrailState();
  advanceTrail(state, time, settings, view);
  let before = rendered(state, settings);
  let biggestRise = 0;
  let biggestFall = 0;
  for (const [peaks, terrain] of [
    [2, 12],
    [0.2, 13],
    [1.5, 20],
  ]) {
    settings.peaks = peaks;
    advanceTrail(state, { ...time, terrain }, settings, view);
    advanceTrailDisplay(state, settings, 1 / 60, true);
    const after = rendered(state, settings);
    after.forEach((point, index) => {
      const ground =
        terrainHeight(
          point.x / settings.spread,
          point.z / settings.depth,
          terrain,
          peaks,
          settings.extent,
          terrainSceneIndex[settings.scene],
        ) * settings.elevation;
      expect(point.y - ground).toBeCloseTo(settings.trailLift, 5);
      expect(Math.hypot(point.x - before[index].x, point.z - before[index].z)).toBeLessThanOrEqual(
        settings.routeMaxSpeed / 60 + 0.00001,
      );
      biggestRise = Math.max(biggestRise, point.y - before[index].y);
      biggestFall = Math.max(biggestFall, before[index].y - point.y);
    });
    expect(state.display.moving).toBe(true);
    before = after;
  }
  expect(biggestRise).toBeGreaterThan(5);
  expect(biggestFall).toBeGreaterThan(5);
});

test("height and slope cannot slow movement toward the same horizontal target", () => {
  const settings = { ...routeExperimentSettings, peaks: 2, elevation: 2 };
  const state = createTrailState();
  advanceTrail(state, time, settings, view);
  resetTrailConnection(state, settings);
  advanceTrailDisplay(state, settings, 0, false);
  state.replan = true;
  advanceTrail(state, time, settings, view);
  const flat = structuredClone(state);
  advanceTrailDisplay(state, settings, 1 / 60, true);
  advanceTrailDisplay(flat, { ...settings, peaks: 0, elevation: 0.15 }, 1 / 60, true);
  expect(state.display).toEqual(flat.display);
});

test("middle checkpoints keep smooth approaches throughout a dragged reroute", () => {
  const settings = {
    ...atlasTerrainSettings,
    trail: 1,
    checkpointMotion: false,
    routeMaxSpeed: 1.5,
  };
  const state = createTrailState();
  advanceTrail(state, time, settings, view);
  moveTrailCheckpoint(state, 1, { x: 2, z: -1 });
  moveTrailCheckpoint(state, 2, { x: -2, z: 1.5 });
  advanceTrail(state, time, settings, view);
  for (let frame = 0; frame < 240; frame++) {
    advanceTrailDisplay(state, settings, 1 / 60, true);
    for (const index of [trailNodesPerLeg, 2 * trailNodesPerLeg]) {
      const a = state.display.nodes[index - 1],
        p = state.display.nodes[index],
        b = state.display.nodes[index + 1];
      const incoming = { x: p.x - a.x, z: p.z - a.z },
        outgoing = { x: b.x - p.x, z: b.z - p.z };
      expect(Math.hypot(incoming.x, incoming.z)).toBeGreaterThan(0.02);
      expect(
        (incoming.x * outgoing.x + incoming.z * outgoing.z) /
          (Math.hypot(incoming.x, incoming.z) * Math.hypot(outgoing.x, outgoing.z)),
      ).toBeGreaterThan(0.999999);
    }
  }
  expect(state.display.moving).toBe(false);
  expect(state.display.nodes[trailNodesPerLeg]).toEqual({ x: 2, z: -1 });
  expect(state.display.nodes[2 * trailNodesPerLeg]).toEqual({ x: -2, z: 1.5 });
});
