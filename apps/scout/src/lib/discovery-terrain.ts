import { d, std } from "typegpu";

// Scalar samples are shared by CPU path search and GPU rendering.
function terrainFract(value: number) {
  "use gpu";
  return value - Math.floor(value);
}

function terrainMix(a: number, b: number, t: number) {
  "use gpu";
  return a * (1 - t) + b * t;
}

function terrainPermutation(value: number) {
  "use gpu";
  // Keep gradient selection in small, exact integers. A floating-point hash can
  // pick different gradients after CPU rounding or GPU shader optimization.
  const cell = ((d.i32(value) % 289) + 289) % 289;
  return ((cell * 34 + 1) * cell) % 289;
}

function terrainBlend(t: number) {
  "use gpu";
  return Math.fround(
    Math.fround(Math.fround(t * t) * t) *
      Math.fround(Math.fround(t * Math.fround(Math.fround(t * 6) - 15)) + 10),
  );
}

function terrainGradient(cx: number, cy: number, cz: number, x: number, y: number, z: number) {
  "use gpu";
  const direction =
    d.u32(terrainPermutation(terrainPermutation(terrainPermutation(cx) + cy) + cz)) % 16;
  const u = Math.fround(direction < 8 ? x : y);
  const v = Math.fround(direction < 4 ? y : direction === 12 || direction === 14 ? x : z);
  return ((direction & 1) === 0 ? u : -u) + ((direction & 2) === 0 ? v : -v);
}

function terrainNoise(x: number, y: number, z: number) {
  "use gpu";
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  const fx = Math.fround(terrainFract(x));
  const fy = Math.fround(terrainFract(y));
  const fz = Math.fround(terrainFract(z));
  const bx = terrainBlend(fx);
  const by = terrainBlend(fy);
  const bz = terrainBlend(fz);
  return terrainMix(
    terrainMix(
      terrainMix(
        terrainGradient(cx, cy, cz, fx, fy, fz),
        terrainGradient(cx + 1, cy, cz, fx - 1, fy, fz),
        bx,
      ),
      terrainMix(
        terrainGradient(cx, cy + 1, cz, fx, fy - 1, fz),
        terrainGradient(cx + 1, cy + 1, cz, fx - 1, fy - 1, fz),
        bx,
      ),
      by,
    ),
    terrainMix(
      terrainMix(
        terrainGradient(cx, cy, cz + 1, fx, fy, fz - 1),
        terrainGradient(cx + 1, cy, cz + 1, fx - 1, fy, fz - 1),
        bx,
      ),
      terrainMix(
        terrainGradient(cx, cy + 1, cz + 1, fx, fy - 1, fz - 1),
        terrainGradient(cx + 1, cy + 1, cz + 1, fx - 1, fy - 1, fz - 1),
        bx,
      ),
      by,
    ),
    bz,
  );
}

export function terrainHeight(
  x: number,
  z: number,
  time: number,
  peaks: number,
  extent: number,
  scene: number,
) {
  "use gpu";
  if (scene > 0) {
    const drift = Math.sin((time - 12) * 0.2) * 0.8;
    const firstX = scene === 1 ? 0 : -0.9;
    const firstZ = scene === 1 ? drift : -0.55 + drift;
    const first = Math.exp(-((x - firstX) ** 2 + (z - firstZ) ** 2) / 0.7);
    const second = Math.exp(-((x - 0.9) ** 2 + (z - 0.55 - drift) ** 2) / 0.7);
    return 0.17 + peaks * 1.6 * (first + (scene === 2 ? second : 0));
  }
  const broad = terrainNoise(
    Math.fround(x * 0.55 + 7.3),
    Math.fround(z * 0.65 + 3.8),
    Math.fround(time * 0.13 + 2.4),
  );
  const ridges = terrainNoise(
    Math.fround(x * 1.05 - 4.1),
    Math.fround(z * 1.2 + 8.2),
    Math.fround(time * 0.17 + 5.7),
  );
  const field = 0.5 + broad * 0.65 + ridges * 0.2;
  const edge =
    (1 - std.smoothstep(3.8, 5.8, Math.abs(x) / extent)) *
    (1 - std.smoothstep(2.2, 3.8, Math.abs(z) / extent));
  const relief = Math.max(0, field - 0.22) * 2.4;
  const summit = Math.max(0, relief - 0.75);
  return (relief + peaks * summit * summit) * edge;
}

export function terrainScale(width: number, frameHeight: number, zoom: number) {
  "use gpu";
  return std.min(std.min(width / 8.5, frameHeight / 6.25), 96) * zoom;
}

export function projectTerrain(
  point: d.v3f,
  viewport: d.v2f,
  camera: d.v3f,
  offset: d.v2f,
  frameHeight: number,
) {
  "use gpu";
  const yaw = camera.y;
  const pitch = camera.x;
  const x = point.x * std.cos(yaw) - point.z * std.sin(yaw);
  const z = point.x * std.sin(yaw) + point.z * std.cos(yaw);
  const vertical = point.y * std.cos(pitch) - z * std.sin(pitch);
  const depth = z * std.cos(pitch) + point.y * std.sin(pitch);
  const scale = terrainScale(viewport.x, frameHeight, camera.z);
  const frameRatio = frameHeight / viewport.y;
  return d.vec3f(
    offset.x + (x * scale * 2) / viewport.x,
    1 - frameRatio + offset.y * frameRatio + (vertical * scale * 2) / viewport.y,
    0.5 - depth / 256,
  );
}

export function terrainColor(
  world: d.v3f,
  normal: d.v3f,
  surfaceHeight: number,
  lineWidth: number,
  time: number,
  screenX: number,
  appearance: d.v4f,
  extent: number,
) {
  "use gpu";
  const n = std.normalize(normal);
  const daylight = std.max(0, std.dot(n, std.normalize(d.vec3f(-0.6, 1, -0.45))));
  const phase = std.fract(surfaceHeight / appearance.x);
  const lineDistance = std.min(phase, 1 - phase);
  const top = std.max(n.y, 0);
  const contour = (1 - std.smoothstep(0, std.max(lineWidth, 0.015), lineDistance)) * top;
  const sweepPosition = std.sin(time * 0.22) * 4;
  const sweep =
    std.exp(-std.pow((world.x + world.z * 0.55 - sweepPosition) * 1.7, 2)) * appearance.z;
  const highlight = std.pow(std.max(0, std.dot(n, std.normalize(d.vec3f(-0.35, 1, 0.4)))), 20);
  const shadow = std.exp(-(1 - phase) * 18) * top * 0.07;
  const paper = std.sub(d.vec3f(0.985 - shadow), std.mul(d.vec3f(0.23, 0.2, 0.17), 1 - daylight));
  const ink = std.mix(d.vec3f(0.38, 0.54, 0.49), d.vec3f(0.12, 0.4, 0.73), std.min(sweep * 0.8, 1));
  const color = std.add(
    std.mix(paper, ink, (contour + (1 - top) * 0.28) * std.min(appearance.y + sweep * 0.22, 1)),
    d.vec3f(highlight * sweep * 0.12),
  );
  const edge =
    (1 - std.smoothstep(4.2, 5.8, std.abs(world.x) / extent)) *
    (1 - std.smoothstep(2.8, 3.8, std.abs(world.z) / extent));
  const opacity =
    edge *
    std.mix(1, std.smoothstep(0.26, 0.52, screenX), appearance.w) *
    std.smoothstep(0.015, 0.12, surfaceHeight);
  return d.vec4f(std.mul(color, opacity), opacity);
}
