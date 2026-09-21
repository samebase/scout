import { expect, test } from "vite-plus/test";
import tgpu, { d } from "typegpu";
import { terraceVertex, terraceVertexAddress } from "./terrain-terraces";

test("large terrain draws keep each triangle together past the float precision limit", () => {
  const triangleCount = 512 * 320 * 2;
  for (const first of [16777221, 17694717, 23592957, 4294967292]) {
    const addresses = [first, first + 1, first + 2].map((index) =>
      terraceVertexAddress(index, triangleCount),
    );
    for (const address of addresses) {
      expect(address.x).toBe(Math.floor(first / 18) % triangleCount);
      expect(address.y).toBe(Math.floor(first / (18 * triangleCount)));
    }
    expect(addresses.map((address) => address.z)).toEqual([
      first % 18,
      (first + 1) % 18,
      (first + 2) % 18,
    ]);
  }
});

test("GPU vertex addressing never passes integer indices through floating point", () => {
  const address = tgpu.fn([d.u32, d.u32], d.vec3u)(terraceVertexAddress);
  const shader = tgpu.resolve([address]);
  expect(shader).not.toContain("f32");
  expect(shader).toContain(" / ");
});

function horizontalArea(a: d.v4f, b: d.v4f, c: d.v4f) {
  return Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
}

test("terraces cover the slope with flat levels and vertical risers, without ramps or gaps", () => {
  const low = d.vec3f(-1, 0.05, -1);
  const middle = d.vec3f(1, 0.27, -1);
  const high = d.vec3f(0, 0.49, 1);
  let coveredArea = 0;
  let risers = 0;
  for (let band = 0; band < 5; band++) {
    const level = band * 0.1;
    for (let triangle = 0; triangle < 6; triangle++) {
      const a = terraceVertex(low, middle, high, level, 0.1, triangle * 3);
      const b = terraceVertex(low, middle, high, level, 0.1, triangle * 3 + 1);
      const c = terraceVertex(low, middle, high, level, 0.1, triangle * 3 + 2);
      const area = horizontalArea(a, b, c);
      if (triangle < 4 && area > 0) {
        coveredArea += area;
        expect(a.y).toBeCloseTo(level);
        expect(b.y).toBeCloseTo(level);
        expect(c.y).toBeCloseTo(level);
      }
      if (triangle >= 4 && Math.max(a.y, b.y, c.y) > Math.min(a.y, b.y, c.y)) {
        risers++;
        expect(area).toBeCloseTo(0);
        expect(Math.min(a.y, b.y, c.y)).toBeCloseTo(level);
        expect(Math.max(a.y, b.y, c.y)).toBeCloseTo(level + 0.1);
      }
    }
  }
  expect(coveredArea).toBeCloseTo(2);
  expect(risers).toBe(8);
});

test("a level triangle remains a flat top", () => {
  const a = d.vec3f(-1, 0.25, -1);
  const b = d.vec3f(1, 0.25, -1);
  const c = d.vec3f(0, 0.25, 1);
  const first = terraceVertex(a, b, c, 0.2, 0.1, 0);
  const second = terraceVertex(a, b, c, 0.2, 0.1, 1);
  const third = terraceVertex(a, b, c, 0.2, 0.1, 2);
  expect(horizontalArea(first, second, third)).toBeCloseTo(2);
  for (const point of [first, second, third]) expect(point.y).toBeCloseTo(0.2);
});

test("nearly flat ground keeps its entire area instead of opening gaps around a hill", () => {
  const low = d.vec3f(-1, 0.17, -1);
  const middle = d.vec3f(1, 0.17000003, -1);
  const high = d.vec3f(0, 0.17000006, 1);
  let area = 0;
  for (let triangle = 0; triangle < 4; triangle++) {
    area += horizontalArea(
      terraceVertex(low, middle, high, 0.13, 0.13, triangle * 3),
      terraceVertex(low, middle, high, 0.13, 0.13, triangle * 3 + 1),
      terraceVertex(low, middle, high, 0.13, 0.13, triangle * 3 + 2),
    );
  }
  expect(area).toBeCloseTo(2, 5);
});
