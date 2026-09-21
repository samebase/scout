import { trailNodesPerLeg, trailSplineTangent } from "./terrain-trail";
import { roundTrailCheckpoints } from "./terrain-trail-joins";
import type { TerrainSettings } from "./terrain-settings";

type Point = { x: number; z: number };
type Scale = Pick<TerrainSettings, "spread" | "depth">;

function distance(a: Point, b: Point, scale: Scale) {
  const dx = (b.x - a.x) * scale.spread;
  const dz = (b.z - a.z) * scale.depth;
  return Math.sqrt(dx * dx + dz * dz);
}

function effort(length: number, rise: number) {
  return length + (12 * rise * rise) / Math.max(length, 0.0001) + (4000 / 600) * Math.max(0, rise);
}

export function createTrailSurface(
  height: (x: number, z: number) => number,
  settings: Pick<TerrainSettings, "extent">,
  checkpoints: Point[],
) {
  const margin = settings.extent;
  const left = Math.min(-5.8 * margin, ...checkpoints.map((p) => p.x - margin));
  const right = Math.max(5.8 * margin, ...checkpoints.map((p) => p.x + margin));
  const top = Math.min(-3.8 * margin, ...checkpoints.map((p) => p.z - margin));
  const bottom = Math.max(3.8 * margin, ...checkpoints.map((p) => p.z + margin));
  const columns = 80,
    rows = 56;
  const dx = (right - left) / columns,
    dz = (bottom - top) / rows;
  const points = Array.from({ length: (columns + 1) * (rows + 1) }, (_, index) => ({
    x: left + (index % (columns + 1)) * dx,
    z: top + Math.floor(index / (columns + 1)) * dz,
  }));
  const heights = new Float64Array(points.length).fill(NaN);
  const at = (index: number) => {
    if (Number.isNaN(heights[index])) heights[index] = height(points[index].x, points[index].z);
    return heights[index];
  };
  const sample = (x: number, z: number) => {
    const u = Math.max(0, Math.min(columns, (x - left) / dx));
    const v = Math.max(0, Math.min(rows, (z - top) / dz));
    const col = Math.min(columns - 1, Math.floor(u));
    const row = Math.min(rows - 1, Math.floor(v));
    const a = row * (columns + 1) + col;
    const across = u - col,
      down = v - row;
    return (
      (at(a) * (1 - across) + at(a + 1) * across) * (1 - down) +
      (at(a + columns + 1) * (1 - across) + at(a + columns + 2) * across) * down
    );
  };
  return { points, sample, columns, rows, left, right, top, bottom, dx, dz };
}

function segmentCost(
  a: Point,
  b: Point,
  height: (x: number, z: number) => number,
  scale: Scale,
  spacing: number,
) {
  const length = distance(a, b, scale);
  const samples = Math.max(1, Math.ceil(length / spacing));
  let previous = height(a.x, a.z),
    total = 0;
  for (let i = 1; i <= samples; i++) {
    const y = height(a.x + ((b.x - a.x) * i) / samples, a.z + ((b.z - a.z) * i) / samples);
    total += effort(length / samples, y - previous);
    previous = y;
  }
  return total;
}

const neighbors = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
  [-2, -1],
  [-2, 1],
  [2, -1],
  [2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
];

function searchLeg(
  start: Point,
  end: Point,
  surface: ReturnType<typeof createTrailSurface>,
  scale: Scale,
) {
  const { points, columns, rows, sample, dx, dz } = surface;
  const spacing = Math.min(dx * scale.spread, dz * scale.depth) * 0.5;
  const cost = (a: Point, b: Point) => segmentCost(a, b, sample, scale, spacing);
  const nearest = (p: Point) =>
    Math.round((p.z - surface.top) / dz) * (columns + 1) + Math.round((p.x - surface.left) / dx);
  const goal = nearest(end);
  const costs = new Float64Array(points.length).fill(Infinity);
  const parents = new Int32Array(points.length).fill(-1);
  const queue: { index: number; score: number }[] = [];
  const push = (index: number, score: number) => {
    let child = queue.length;
    queue.push({ index, score });
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (queue[parent].score <= score) break;
      queue[child] = queue[parent];
      child = parent;
    }
    queue[child] = { index, score };
  };
  const pop = () => {
    const first = queue[0];
    const last = queue.pop();
    if (last && queue.length) {
      let parent = 0;
      while (parent * 2 + 1 < queue.length) {
        let child = parent * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++;
        if (last.score <= queue[child].score) break;
        queue[parent] = queue[child];
        parent = child;
      }
      queue[parent] = last;
    }
    return first;
  };
  const first = nearest(start);
  costs[first] = cost(start, points[first]);
  push(first, costs[first] + distance(points[first], end, scale));
  const visited = new Uint8Array(points.length);
  while (queue.length) {
    const { index } = pop();
    if (visited[index]) continue;
    if (index === goal) break;
    visited[index] = 1;
    const col = index % (columns + 1),
      row = Math.floor(index / (columns + 1));
    for (const [x, z] of neighbors) {
      if (col + x < 0 || col + x > columns || row + z < 0 || row + z > rows) continue;
      const next = index + z * (columns + 1) + x;
      if (visited[next]) continue;
      const candidate = costs[index] + cost(points[index], points[next]);
      if (candidate >= costs[next]) continue;
      costs[next] = candidate;
      parents[next] = index;
      push(next, candidate + distance(points[next], end, scale));
    }
  }
  const reversed = [end];
  for (let index = goal; index !== -1; index = parents[index]) reversed.push(points[index]);
  const path = [start, ...reversed.reverse()];
  const cumulative = [0];
  for (let i = 1; i < path.length; i++)
    cumulative.push(cumulative[i - 1] + cost(path[i - 1], path[i]));
  // Remove the grid's stair steps only when the shortcut costs no more than the
  // path it replaces. Long shortcuts are sampled, so they cannot skip a summit.
  const simplified = [start];
  let index = 0;
  while (index < path.length - 1) {
    let next = index + 1;
    for (let candidate = path.length - 1; candidate > index + 1; candidate--) {
      if (
        cost(path[index], path[candidate]) <=
        (cumulative[candidate] - cumulative[index]) * 1.005 + 1e-6
      ) {
        next = candidate;
        break;
      }
    }
    simplified.push(path[next]);
    index = next;
  }
  return simplified;
}

function resample(path: Point[], scale: Scale) {
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(lengths[i - 1] + distance(path[i - 1], path[i], scale));
  const total = lengths[lengths.length - 1];
  let segment = 0;
  return Array.from({ length: trailNodesPerLeg + 1 }, (_, index) => {
    if (index === 0) return { ...path[0] };
    if (index === trailNodesPerLeg) return { ...path[path.length - 1] };
    const target = (total * index) / trailNodesPerLeg;
    while (segment < path.length - 2 && lengths[segment + 1] < target) segment++;
    const t = (target - lengths[segment]) / Math.max(1e-9, lengths[segment + 1] - lengths[segment]);
    return {
      x: path[segment].x + (path[segment + 1].x - path[segment].x) * t,
      z: path[segment].z + (path[segment + 1].z - path[segment].z) * t,
    };
  });
}

export function planTrail(
  checkpoints: Point[],
  surface: ReturnType<typeof createTrailSurface>,
  scale: Scale,
) {
  const nodes: Point[] = [];
  for (let leg = 0; leg < checkpoints.length - 1; leg++) {
    const points = resample(
      searchLeg(checkpoints[leg], checkpoints[leg + 1], surface, scale),
      scale,
    );
    nodes.push(...(leg ? points.slice(1) : points));
  }
  return roundTrailCheckpoints(refineTrail(nodes, surface, scale, 2), scale);
}

const curveSamples = Array.from({ length: 6 }, (_, i) => {
  const t = (i + 1) / 6,
    t2 = t * t,
    t3 = t2 * t;
  return {
    b: 2 * t3 - 3 * t2 + 1,
    c: -2 * t3 + 3 * t2,
    incoming: t3 - 2 * t2 + t,
    outgoing: t3 - t2,
  };
});

function refineTrail(
  nodes: Point[],
  surface: ReturnType<typeof createTrailSurface>,
  scale: Scale,
  passes: number,
) {
  // Refine the actual displayed spline, with every non-checkpoint free in x and z.
  // The four user positions are the only fixed controls; there are no turn handles.
  const controls = nodes.map((p) => ({ ...p }));
  const score = (index: number) => {
    const start = Math.max(0, index - 2),
      end = Math.min(nodes.length - 1, index + 2);
    let previousX = controls[start].x,
      previousZ = controls[start].z,
      y = surface.sample(previousX, previousZ),
      total = 0;
    for (let section = start; section < end; section++) {
      const a = controls[Math.max(0, section - 1)],
        b = controls[section],
        c = controls[section + 1],
        e = controls[Math.min(nodes.length - 1, section + 2)];
      const knot = (p: Point, q: Point) =>
        Math.max(0.0001, Math.sqrt(Math.sqrt((q.x - p.x) ** 2 + (q.z - p.z) ** 2)));
      const ab = knot(a, b),
        bc = knot(b, c),
        ce = knot(c, e);
      const incomingX = trailSplineTangent(a.x, b.x, c.x, ab, bc);
      const incomingZ = trailSplineTangent(a.z, b.z, c.z, ab, bc);
      const outgoingX = -trailSplineTangent(e.x, c.x, b.x, ce, bc);
      const outgoingZ = -trailSplineTangent(e.z, c.z, b.z, ce, bc);
      for (const weight of curveSamples) {
        const x =
          b.x * weight.b +
          c.x * weight.c +
          incomingX * weight.incoming +
          outgoingX * weight.outgoing;
        const z =
          b.z * weight.b +
          c.z * weight.c +
          incomingZ * weight.incoming +
          outgoingZ * weight.outgoing;
        const nextY = surface.sample(x, z);
        total += effort(
          Math.sqrt(((x - previousX) * scale.spread) ** 2 + ((z - previousZ) * scale.depth) ** 2),
          nextY - y,
        );
        previousX = x;
        previousZ = z;
        y = nextY;
      }
    }
    return total;
  };
  for (const step of [
    Math.min(surface.dx, surface.dz) * 0.5,
    Math.min(surface.dx, surface.dz) * 0.2,
  ]) {
    for (let pass = 0; pass < passes; pass++) {
      for (let index = 1; index < nodes.length - 1; index++) {
        if (index % trailNodesPerLeg === 0) continue;
        const original = controls[index];
        let best = original,
          bestCost = score(index);
        for (const [dx, dz] of neighbors.slice(0, 8)) {
          controls[index] = { x: original.x + dx * step, z: original.z + dz * step };
          const cost = score(index);
          if (cost < bestCost - 1e-6) {
            bestCost = cost;
            best = controls[index];
          }
        }
        controls[index] = best;
      }
    }
  }
  return controls.map((p, index) => (index % trailNodesPerLeg === 0 ? nodes[index] : p));
}
