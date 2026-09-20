import { d, std } from "typegpu";

function terrainHash(point: d.v3f) {
  "use gpu";
  let p = std.fract(std.mul(point, 0.1031));
  p = std.add(p, std.dot(p, std.add(p.yzx, 33.33)));
  return std.fract((p.x + p.y) * p.z);
}

function terrainGradient(cell: d.v3f, offset: d.v3f) {
  "use gpu";
  const direction = d.u32(terrainHash(cell) * 16);
  const u = direction < 8 ? offset.x : offset.y;
  const v = direction < 4 ? offset.y : direction === 12 || direction === 14 ? offset.x : offset.z;
  return ((direction & 1) === 0 ? u : -u) + ((direction & 2) === 0 ? v : -v);
}

function terrainNoise(point: d.v3f) {
  "use gpu";
  const cell = std.floor(point);
  const fraction = std.fract(point);
  const blend = std.mul(
    std.mul(std.mul(fraction, fraction), fraction),
    std.add(std.mul(fraction, std.sub(std.mul(fraction, 6), 15)), 10),
  );
  return std.mix(
    std.mix(
      std.mix(
        terrainGradient(cell, fraction),
        terrainGradient(std.add(cell, d.vec3f(1, 0, 0)), std.sub(fraction, d.vec3f(1, 0, 0))),
        blend.x,
      ),
      std.mix(
        terrainGradient(std.add(cell, d.vec3f(0, 1, 0)), std.sub(fraction, d.vec3f(0, 1, 0))),
        terrainGradient(std.add(cell, d.vec3f(1, 1, 0)), std.sub(fraction, d.vec3f(1, 1, 0))),
        blend.x,
      ),
      blend.y,
    ),
    std.mix(
      std.mix(
        terrainGradient(std.add(cell, d.vec3f(0, 0, 1)), std.sub(fraction, d.vec3f(0, 0, 1))),
        terrainGradient(std.add(cell, d.vec3f(1, 0, 1)), std.sub(fraction, d.vec3f(1, 0, 1))),
        blend.x,
      ),
      std.mix(
        terrainGradient(std.add(cell, d.vec3f(0, 1, 1)), std.sub(fraction, d.vec3f(0, 1, 1))),
        terrainGradient(std.add(cell, d.vec3f(1, 1, 1)), std.sub(fraction, d.vec3f(1, 1, 1))),
        blend.x,
      ),
      blend.y,
    ),
    blend.z,
  );
}

export function terrainHeight(x: number, z: number, time: number, peaks: number, extent: number) {
  "use gpu";
  const broad = terrainNoise(d.vec3f(x * 0.55 + 7.3, z * 0.65 + 3.8, time * 0.13 + 2.4));
  const ridges = terrainNoise(d.vec3f(x * 1.05 - 4.1, z * 1.2 + 8.2, time * 0.17 + 5.7));
  const field = 0.5 + broad * 0.65 + ridges * 0.2;
  const edge =
    (1 - std.smoothstep(3.8, 5.8, std.abs(x) / extent)) *
    (1 - std.smoothstep(2.2, 3.8, std.abs(z) / extent));
  const relief = std.max(0, field - 0.22) * 2.4;
  const summit = std.max(0, relief - 0.75);
  return (relief + peaks * summit * summit) * edge;
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
  const scale = std.min(std.min(viewport.x / 8.5, frameHeight / 6.25), 96) * camera.z;
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
