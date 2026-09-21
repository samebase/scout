import { expect, test } from "vite-plus/test";
import { defaultTerrainSettings } from "./terrain-settings";
import {
  advanceTrail,
  createTrailState,
  projectTrailNode,
  type TrailView,
} from "./terrain-trail-motion";
import { trailNodesPerLeg } from "./terrain-trail";
import {
  moveTrailCheckpoint,
  pickTrailCheckpoint,
  trailGroundAtPointer,
} from "./terrain-trail-drag";

const settings = { ...defaultTerrainSettings, trail: 1 };
const view: TrailView = {
  width: 1100,
  height: 856,
  frameHeight: 576,
  bounds: { left: 0, top: 0, right: 1100, bottom: 576 },
  obstacles: [],
  interacting: false,
};

test.each([
  { tilt: 12.76875, rotation: -60.523242, spread: 1.6, depth: 1.6 },
  { tilt: 25.60234, rotation: -52.78789, spread: 3.2, depth: 0.8 },
  { tilt: 85, rotation: 117, spread: 0.8, depth: 3.2 },
])("dragging follows the projected ground at $tilt degrees", (camera) => {
  const options = { ...settings, ...camera, elevation: 1.2, peaks: 2 };
  for (const point of [
    { x: 0.6, z: -1.3 },
    { x: -1.2, z: 0.4 },
    { x: 1.5, z: 2.1 },
  ]) {
    const screen = projectTrailNode(point, 12, options, view);
    const ground = trailGroundAtPointer(screen, 12, options, view);
    const projected = projectTrailNode(ground, 12, options, view);
    expect(Math.hypot(screen.x - projected.x, screen.y - projected.y)).toBeLessThan(0.1);
  }
});

test("each visible checkpoint can be picked without selecting empty terrain", () => {
  const state = createTrailState();
  advanceTrail(state, { terrain: 12, checkpoints: 0, shimmer: 4 }, settings, view);
  for (let checkpoint = 0; checkpoint < 4; checkpoint++) {
    const screen = projectTrailNode(state.nodes[checkpoint * trailNodesPerLeg], 12, settings, view);
    expect(
      pickTrailCheckpoint(state, { x: screen.x + 5, y: screen.y - 4 }, 12, settings, view)
        ?.checkpoint,
    ).toBe(checkpoint);
  }
  expect(pickTrailCheckpoint(state, { x: -100, y: -100 }, 12, settings, view)).toBeNull();
  expect(
    pickTrailCheckpoint(
      state,
      projectTrailNode(state.nodes[0], 12, settings, view),
      12,
      { ...settings, trail: 0 },
      view,
    ),
  ).toBeNull();
});

test.each([0, 1, 2, 3])(
  "moving checkpoint %i preserves the other three and its new home",
  (checkpoint) => {
    const options = { ...settings, checkpointDrift: 0, checkpointAvoidance: false };
    const state = createTrailState();
    advanceTrail(state, { terrain: 12, checkpoints: 0, shimmer: 4 }, options, view);
    const original = structuredClone(state);
    const index = checkpoint * trailNodesPerLeg;
    const position = { x: state.nodes[index].x + 0.8, z: state.nodes[index].z - 0.3 };
    moveTrailCheckpoint(state, checkpoint, position);
    expect(state.nodes[index]).toMatchObject(position);
    expect(state.homes[checkpoint]).toEqual(position);
    for (let other = 0; other < 4; other++)
      if (other !== checkpoint) {
        expect(state.nodes[other * trailNodesPerLeg]).toEqual(
          original.nodes[other * trailNodesPerLeg],
        );
        expect(state.homes[other]).toEqual(original.homes[other]);
      }
    expect(state.display.nodes[index]).toEqual(position);
    for (let other = 0; other < original.display.nodes.length; other++) {
      if (Math.abs(other - index) >= trailNodesPerLeg - 1)
        expect(state.display.nodes[other]).toEqual(original.display.nodes[other]);
    }
    for (const middle of [trailNodesPerLeg, 2 * trailNodesPerLeg]) {
      const left = state.display.nodes[middle - 1];
      const point = state.display.nodes[middle];
      const right = state.display.nodes[middle + 1];
      expect(left.x + right.x).toBeCloseTo(2 * point.x, 10);
      expect(left.z + right.z).toBeCloseTo(2 * point.z, 10);
    }
    for (let frame = 1; frame <= 24 * 6; frame++)
      advanceTrail(state, { terrain: 12, checkpoints: frame / 24, shimmer: 4 }, options, view);
    expect(state.nodes[index]).toMatchObject(position);
  },
);
