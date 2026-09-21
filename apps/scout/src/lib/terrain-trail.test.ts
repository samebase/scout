import { expect, test } from "vite-plus/test";
import { d } from "typegpu";
import { terrainHeight } from "./discovery-terrain";
import { trailPoint, trailSpline } from "./terrain-trail";

test("the route follows the evolving ground with its chosen clearance, including tall peaks", () => {
  for (const time of [0, 5, 20]) {
    for (const elevation of [0.45, 3]) {
      for (let index = 0; index <= 32; index++) {
        const point = trailPoint(
          d.vec2f(Math.sin(index), (index / 32 - 0.5) * 7),
          time,
          2,
          3,
          elevation,
          0.02,
          0,
        );
        const ground = terrainHeight(point.x, point.z, time, 2, 3, 0) * elevation;
        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.y - ground).toBeCloseTo(0.02, 5);
      }
    }
  }
});

test("spline segments meet at the rope nodes with matching directions", () => {
  const nodes = [d.vec2f(-1, -2), d.vec2f(2, -1), d.vec2f(1, 2), d.vec2f(0, 3), d.vec2f(3, 4)];
  const left = trailSpline(nodes[0], nodes[1], nodes[2], nodes[3], 1);
  const right = trailSpline(nodes[1], nodes[2], nodes[3], nodes[4], 0);
  expect(left).toEqual(nodes[2]);
  expect(right).toEqual(nodes[2]);
  const before = trailSpline(nodes[0], nodes[1], nodes[2], nodes[3], 0.999);
  const after = trailSpline(nodes[1], nodes[2], nodes[3], nodes[4], 0.001);
  const incoming = [left.x - before.x, left.y - before.y];
  const outgoing = [after.x - right.x, after.y - right.y];
  expect(
    (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
      (Math.hypot(...incoming) * Math.hypot(...outgoing)),
  ).toBeGreaterThan(0.999);
});

test("the short handle from the broken screenshot cannot overshoot and double back", () => {
  const a = d.vec2f(0.0125435601, -0.5311756273);
  const b = d.vec2f(0.7482584593, 0.6363717007);
  const c = d.vec2f(0.7253023782, 0.7066885439);
  const e = d.vec2f(0.7023462972, 0.7770053871);
  let previous = b;
  for (let index = 1; index <= 100; index++) {
    const point = trailSpline(a, b, c, e, index / 100);
    expect(point.y).toBeGreaterThan(previous.y);
    expect(point.y).toBeLessThanOrEqual(c.y + 1e-6);
    expect(point.x).toBeLessThan(b.x + 0.02);
    previous = point;
  }
});

test("a right-angle route carries the same direction through a checkpoint on changing terrain", () => {
  const nodes = [d.vec2f(-2, 0), d.vec2f(-1, 0), d.vec2f(0, 0), d.vec2f(0, 1), d.vec2f(0, 2)];
  const before = trailSpline(nodes[0], nodes[1], nodes[2], nodes[3], 0.999);
  const after = trailSpline(nodes[1], nodes[2], nodes[3], nodes[4], 0.001);
  for (const time of [0, 12, 24]) {
    for (const peaks of [0, 2]) {
      const a = trailPoint(before, time, peaks, 1.9, 0.45, 0.05, 0);
      const b = trailPoint(nodes[2], time, peaks, 1.9, 0.45, 0.05, 0);
      const c = trailPoint(after, time, peaks, 1.9, 0.45, 0.05, 0);
      const incoming = [b.x - a.x, b.y - a.y, b.z - a.z];
      const outgoing = [c.x - b.x, c.y - b.y, c.z - b.z];
      const agreement =
        incoming.reduce((sum, value, index) => sum + value * outgoing[index], 0) /
        (Math.hypot(...incoming) * Math.hypot(...outgoing));
      expect(agreement).toBeGreaterThan(0.999);
    }
  }
});
