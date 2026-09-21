import type { TerrainSettings } from "./terrain-settings";
import { trailNodesPerLeg } from "./terrain-trail";

export function roundTrailCheckpoints<T extends { x: number; z: number }>(
  nodes: T[],
  scale: Pick<TerrainSettings, "spread" | "depth">,
) {
  const rounded = nodes.map((point) => ({ ...point }));
  const world = (index: number) => ({
    x: nodes[index].x * scale.spread,
    z: nodes[index].z * scale.depth,
  });
  const direction = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return {
      x: (b.x - a.x) / Math.max(length, 1e-9),
      z: (b.z - a.z) / Math.max(length, 1e-9),
      length,
    };
  };
  const set = (index: number, x: number, z: number) => {
    rounded[index].x = x / scale.spread;
    rounded[index].z = z / scale.depth;
  };
  for (let index = trailNodesPerLeg; index < nodes.length - 1; index += trailNodesPerLeg) {
    const a = world(index - 3),
      point = world(index),
      b = world(index + 3);
    const incoming = direction(a, point),
      outgoing = direction(point, b);
    const radius = Math.min(incoming.length, outgoing.length) * 0.3;
    if (radius < 1e-6) continue;
    const sumX = incoming.x + outgoing.x,
      sumZ = incoming.z + outgoing.z;
    const sumLength = Math.hypot(sumX, sumZ);
    // A reversal needs a rounded turn through the checkpoint, not a zero tangent.
    const tx = sumLength > 1e-6 ? sumX / sumLength : -incoming.z;
    const tz = sumLength > 1e-6 ? sumZ / sumLength : incoming.x;
    const left = { x: point.x - tx * radius, z: point.z - tz * radius };
    const right = { x: point.x + tx * radius, z: point.z + tz * radius };
    set(index - 1, left.x, left.z);
    set(index + 1, right.x, right.z);

    // Symmetric neighbors give a nonzero shared tangent. Cubic approaches spread
    // the turn across the surrounding route instead of moving the corner next door.
    const entry = direction(world(index - 4), a),
      exit = direction(b, world(index + 4));
    const before = direction(a, left).length / 8,
      after = direction(right, b).length / 8;
    set(
      index - 2,
      (a.x + left.x) / 2 + (entry.x - tx) * before,
      (a.z + left.z) / 2 + (entry.z - tz) * before,
    );
    set(
      index + 2,
      (right.x + b.x) / 2 + (tx - exit.x) * after,
      (right.z + b.z) / 2 + (tz - exit.z) * after,
    );
  }
  return rounded;
}
