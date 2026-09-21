import { d } from "typegpu";
import { expect, test } from "vite-plus/test";
import { defaultTerrainSettings } from "./terrain-settings";
import { trailNodesPerLeg, trailSpline } from "./terrain-trail";
import { createTrailSurface, planTrail } from "./terrain-trail-routing";
import { terrainHeight } from "./discovery-terrain";

const settings = { ...defaultTerrainSettings, spread: 1, depth: 1 };
const endpoints = [
  { x: 0, z: -3 },
  { x: 0, z: 3 },
];
const hill = (rise: number) => (x: number, z: number) => rise * Math.exp(-(x * x + z * z) / 0.6);
function plan(height: (x: number, z: number) => number, checkpoints = endpoints, scale = settings) {
  return planTrail(checkpoints, createTrailSurface(height, scale, checkpoints), scale);
}
function measure(
  nodes: { x: number; z: number }[],
  height: (x: number, z: number) => number,
  scale = settings,
) {
  const controls = nodes.map((p) => d.vec2f(p.x, p.z));
  let previous = controls[0],
    y = height(previous.x, previous.y),
    length = 0,
    climb = 0;
  const samples = (nodes.length - 1) * 32;
  for (let sample = 1; sample <= samples; sample++) {
    const progress = sample / 32;
    const section = Math.min(Math.floor(progress), nodes.length - 2);
    const point = trailSpline(
      controls[Math.max(0, section - 1)],
      controls[section],
      controls[section + 1],
      controls[Math.min(nodes.length - 1, section + 2)],
      progress - section,
    );
    const nextY = height(point.x, point.y);
    length += Math.hypot(
      (point.x - previous.x) * scale.spread,
      (point.y - previous.y) * scale.depth,
      nextY - y,
    );
    climb += Math.max(0, nextY - y);
    previous = point;
    y = nextY;
  }
  return { length, climb };
}

test("flat ground connects the supplied destinations directly", () => {
  const route = plan(() => 0);
  expect(route[0]).toEqual(endpoints[0]);
  expect(route.at(-1)).toEqual(endpoints[1]);
  expect(Math.max(...route.map((p) => Math.abs(p.x)))).toBeLessThan(0.001);
  expect(measure(route, () => 0).length).toBeCloseTo(6, 4);
});

test("a detour around a tall summit is shorter along the surface", () => {
  const height = hill(2.5);
  const direct = plan(() => 0),
    around = plan(height);
  expect(measure(around, height).length).toBeLessThan(measure(direct, height).length * 0.85);
  expect(measure(around, height).climb).toBeLessThan(measure(direct, height).climb * 0.5);
});

test("raising a mountain changes the route without a separate avoidance weight", () => {
  const low = plan(hill(0.05)),
    high = plan(hill(2.5));
  expect(Math.max(...low.map((p) => Math.abs(p.x)))).toBeLessThan(
    Math.max(...high.map((p) => Math.abs(p.x))) * 0.25,
  );
});

test("the route follows a winding valley through both sides of the field", () => {
  const height = (x: number, z: number) => 8 * (x - 0.7 * Math.sin(((z + 3) * Math.PI) / 3)) ** 2;
  const route = plan(height);
  expect(Math.min(...route.map((p) => p.x))).toBeLessThan(-0.3);
  expect(Math.max(...route.map((p) => p.x))).toBeGreaterThan(0.3);
  expect(measure(route, height).length).toBeLessThan(
    measure(
      plan(() => 0),
      height,
    ).length * 0.6,
  );
});

test("routing can go backwards along the endpoint axis to escape a U-shaped ridge", () => {
  const points = [
    { x: 0, z: 0 },
    { x: 0, z: 3 },
  ];
  const height = (x: number, z: number) =>
    8 *
    (Math.exp(-((z - 1) ** 2) / 0.03) * Math.exp(-(x ** 8) / 20) +
      Math.exp(-((Math.abs(x) - 1.3) ** 2) / 0.03) * Math.exp(-((z - 0.2) ** 8) / 1.5));
  const route = plan(height, points);
  expect(Math.min(...route.map((p) => p.z))).toBeLessThan(-0.5);
  expect(measure(route, height).climb).toBeLessThan(
    measure(
      plan(() => 0, points),
      height,
    ).climb * 0.3,
  );
});

test("the four landing checkpoints have rounded approaches and still avoid unnecessary climbs", () => {
  // Actual paused scene from the user's broken-join screenshot.
  const points = [
    { x: 0.4838152119038534, z: -4.368925027290516 },
    { x: 0.7253023782258483, z: 0.7066885438957005 },
    { x: -0.19212154335907672, z: 1.4543662907836017 },
    { x: 0.4637745916296544, z: 4.37086610875293 },
  ];
  const scale = defaultTerrainSettings;
  const height = (x: number, z: number) =>
    terrainHeight(x, z, 12, scale.peaks, scale.extent, 0) * scale.elevation;
  const route = plan(height, points, scale);
  for (let checkpoint = 0; checkpoint < points.length; checkpoint++)
    expect(route[checkpoint * trailNodesPerLeg]).toEqual(points[checkpoint]);
  expect(measure(route, height, scale).climb).toBeLessThan(
    measure(
      plan(() => 0, points, scale),
      height,
      scale,
    ).climb * 0.85,
  );
  for (const index of [trailNodesPerLeg, 2 * trailNodesPerLeg]) {
    const around = route.slice(index - 2, index + 3).map((p) => d.vec2f(p.x, p.z));
    const before = trailSpline(around[0], around[1], around[2], around[3], 0.999);
    const after = trailSpline(around[1], around[2], around[3], around[4], 0.001);
    const a = d.vec2f(around[2].x - before.x, around[2].y - before.y);
    const b = d.vec2f(after.x - around[2].x, after.y - around[2].y);
    expect((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeGreaterThan(
      0.999,
    );
    const incoming = {
      x: route[index].x - route[index - 1].x,
      z: route[index].z - route[index - 1].z,
    };
    const outgoing = {
      x: route[index + 1].x - route[index].x,
      z: route[index + 1].z - route[index].z,
    };
    // The approach has room on both sides, not only matching infinitesimal derivatives.
    expect(Math.hypot(incoming.x * scale.spread, incoming.z * scale.depth)).toBeGreaterThan(0.05);
    expect(
      (incoming.x * outgoing.x + incoming.z * outgoing.z) /
        (Math.hypot(incoming.x, incoming.z) * Math.hypot(outgoing.x, outgoing.z)),
    ).toBeGreaterThan(0.999999);
  }
});

test("doubling back through a middle checkpoint makes a rounded turn with a nonzero tangent", () => {
  const points = [
    { x: -3, z: 0 },
    { x: 0, z: 0 },
    { x: -3, z: 0 },
  ];
  const route = plan(() => 0, points);
  const index = trailNodesPerLeg;
  expect(route[index]).toEqual(points[1]);
  const before = route[index - 1],
    after = route[index + 1];
  expect(Math.hypot(before.x, before.z)).toBeGreaterThan(0.1);
  expect(before.z).toBeLessThan(0);
  expect(after.z).toBeGreaterThan(0);
  const controls = route.slice(index - 2, index + 3).map((p) => d.vec2f(p.x, p.z));
  const left = trailSpline(controls[0], controls[1], controls[2], controls[3], 0.99);
  const right = trailSpline(controls[1], controls[2], controls[3], controls[4], 0.01);
  expect(left.y).toBeLessThan(0);
  expect(right.y).toBeGreaterThan(0);
});

test("absolute altitude does not add travel cost and a high ridge need not descend", () => {
  const normal = plan(hill(2.5)),
    raised = plan((x, z) => 20 + hill(2.5)(x, z));
  for (let i = 0; i < normal.length; i++) {
    expect(Math.abs(raised[i].x)).toBeCloseTo(Math.abs(normal[i].x), 5);
    expect(raised[i].z).toBeCloseTo(normal[i].z, 5);
  }
  expect(
    measure(
      plan((x) => 4 * Math.exp((-x * x) / 0.6)),
      (x) => 4 * Math.exp((-x * x) / 0.6),
    ).length,
  ).toBeCloseTo(6, 3);
});

test("coincident checkpoints produce finite positions", () => {
  const route = plan(hill(2.5), [endpoints[0], endpoints[0]]);
  expect(route.every((p) => p.x === endpoints[0].x && p.z === endpoints[0].z)).toBe(true);
});
