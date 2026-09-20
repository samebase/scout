import { expect, test } from "vite-plus/test";
import { d } from "typegpu";
import { projectTerrain } from "./discovery-terrain";

test("extending the canvas below the hero preserves its camera framing", () => {
  const camera = d.vec3f((25.1 * Math.PI) / 180, (31.8 * Math.PI) / 180, 0.95);
  const offset = d.vec2f(0.58, 0.16);
  for (const { width, height, extension } of [
    { width: 1280, height: 397, extension: 280 },
    { width: 390, height: 328, extension: 120 },
  ]) {
    for (const point of [d.vec3f(0, 0, 0), d.vec3f(-3, 1, 2), d.vec3f(4, 0.5, -2)]) {
      const before = projectTerrain(point, d.vec2f(width, height), camera, offset, height);
      const after = projectTerrain(
        point,
        d.vec2f(width, height + extension),
        camera,
        offset,
        height,
      );
      expect(after.x).toBeCloseTo(before.x);
      expect(((1 - after.y) * (height + extension)) / 2).toBeCloseTo(((1 - before.y) * height) / 2);
      expect(after.z).toBeCloseTo(before.z);
    }
  }
});
