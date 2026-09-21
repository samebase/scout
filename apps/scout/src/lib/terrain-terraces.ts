import { d, std } from "typegpu";

export const verticesPerTerraceBand = 18;

export function terraceVertexAddress(index: number, triangleCount: number) {
  "use gpu";
  // Float division loses vertex addresses above 2^24 and joins unrelated triangles.
  const count = d.u32(triangleCount);
  return d.vec3u(
    std.intdiv(index, verticesPerTerraceBand) % count,
    std.intdiv(index, verticesPerTerraceBand * count),
    index % verticesPerTerraceBand,
  );
}

function pointAtHeight(a: d.v3f, b: d.v3f, height: number) {
  "use gpu";
  return std.mix(a, b, std.clamp((height - a.y) / std.max(b.y - a.y, 1e-12), 0, 1));
}

// Each band clips the original triangle into flat tops and an upright riser.
// The fourth component retains the unstepped height for shading the lip.
export function terraceVertex(
  low: d.v3f,
  middle: d.v3f,
  high: d.v3f,
  level: number,
  step: number,
  vertex: number,
) {
  "use gpu";
  if (level > high.y || level + step <= low.y) return d.vec4f(0);
  if (low.y === high.y) {
    const point = std.select(std.select(high, middle, vertex === 1), low, vertex === 0);
    return std.select(d.vec4f(0), d.vec4f(point.x, level, point.z, point.y), vertex < 3);
  }
  const upper = level + step;
  const corner = vertex % 6;
  const right = corner === 1 || corner === 4 || corner === 5;
  const top = corner === 2 || corner === 3 || corner === 5;
  if (vertex >= 12) {
    if (upper <= low.y || upper > high.y) return d.vec4f(0);
    const leftPoint = pointAtHeight(low, high, upper);
    const rightPoint = std.select(
      pointAtHeight(middle, high, upper),
      pointAtHeight(low, middle, upper),
      upper < middle.y,
    );
    const point = std.select(leftPoint, rightPoint, right);
    return d.vec4f(point.x, top ? upper : level, point.z, upper);
  }
  const a = std.select(middle, low, vertex < 6);
  const b = std.select(high, middle, vertex < 6);
  const bottom = std.max(level, a.y);
  const ceiling = std.min(upper, b.y);
  if (ceiling <= bottom) return d.vec4f(0);
  const height = top ? ceiling : bottom;
  const point = std.select(pointAtHeight(low, high, height), pointAtHeight(a, b, height), right);
  return d.vec4f(point.x, level, point.z, height);
}
