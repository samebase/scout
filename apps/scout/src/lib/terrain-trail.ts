import { d } from "typegpu";
import { terrainHeight } from "./discovery-terrain";

export const trailCheckpoints = 4;
export const trailNodesPerLeg = 16;
export const trailSegments = (trailCheckpoints - 1) * 192;
export const trailNodeCount = (trailCheckpoints - 1) * trailNodesPerLeg + 1;

export function trailSplineTangent(a: number, b: number, c: number, ab: number, bc: number) {
  "use gpu";
  return ((b - a) / ab + (c - b) / bc - (c - a) / (ab + bc)) * bc;
}

function trailSplineAxis(
  a: number,
  b: number,
  c: number,
  e: number,
  ab: number,
  bc: number,
  ce: number,
  t: number,
) {
  "use gpu";
  const incoming = trailSplineTangent(a, b, c, ab, bc);
  const outgoing = -trailSplineTangent(e, c, b, ce, bc);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    b * (2 * t3 - 3 * t2 + 1) +
    c * (-2 * t3 + 3 * t2) +
    incoming * (t3 - 2 * t2 + t) +
    outgoing * (t3 - t2)
  );
}

export function trailSpline(a: d.v2f, b: d.v2f, c: d.v2f, e: d.v2f, t: number) {
  "use gpu";
  // Centripetal spacing stops a long neighbor from making a short segment loop.
  const ab = Math.max(
    0.0001,
    Math.sqrt(Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))),
  );
  const bc = Math.max(
    0.0001,
    Math.sqrt(Math.sqrt((c.x - b.x) * (c.x - b.x) + (c.y - b.y) * (c.y - b.y))),
  );
  const ce = Math.max(
    0.0001,
    Math.sqrt(Math.sqrt((e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y))),
  );
  return d.vec2f(
    trailSplineAxis(a.x, b.x, c.x, e.x, ab, bc, ce, t),
    trailSplineAxis(a.y, b.y, c.y, e.y, ab, bc, ce, t),
  );
}

export function trailPoint(
  position: d.v2f,
  time: number,
  peaks: number,
  extent: number,
  elevation: number,
  clearance: number,
  scene: number,
) {
  "use gpu";
  // Recompute height at the displayed X/Z every frame. Only horizontal positions
  // are animated, so changing terrain cannot leave stale heights below ground.
  const height = terrainHeight(position.x, position.y, time, peaks, extent, scene) * elevation;
  return d.vec3f(position.x, height + clearance, position.y);
}
