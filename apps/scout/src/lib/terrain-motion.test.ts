import { expect, test } from "vite-plus/test";
import { advanceTerrainTime } from "./terrain-motion";
import { atlasTerrainSettings } from "./terrain-settings";

const start = { terrain: 12, shimmer: 4, checkpoints: 1 };

test("checkpoints can animate while the terrain is frozen", () => {
  const next = advanceTerrainTime(start, 0.1, {
    ...atlasTerrainSettings,
    trail: 1,
    terrainMotion: false,
    checkpointSpeed: 2,
  });
  expect(next).toEqual({ terrain: 12, shimmer: 4, checkpoints: 1.2 });
});

test("pausing checkpoints leaves the landscape free to change", () => {
  const next = advanceTerrainTime(start, 0.1, {
    ...atlasTerrainSettings,
    trail: 1,
    checkpointMotion: false,
  });
  expect(next.checkpoints).toBe(start.checkpoints);
  expect(next.terrain).toBeGreaterThan(start.terrain);
  expect(next.shimmer).toBeGreaterThan(start.shimmer);
});

test("changing speeds preserves the current terrain and checkpoint position", () => {
  expect(
    advanceTerrainTime(start, 0, {
      ...atlasTerrainSettings,
      speed: 1,
      evolution: 0,
      checkpointSpeed: 3,
    }),
  ).toEqual(start);
});
