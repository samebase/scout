import { createTrailState } from "./terrain-trail-motion";
import type { TerrainSettings } from "./terrain-settings";

export type TerrainTime = { terrain: number; shimmer: number; checkpoints: number };

export function createTerrainAnimation(settings: TerrainSettings) {
  return {
    scene: settings.scene,
    time: { terrain: 4 * settings.evolution, shimmer: 4, checkpoints: 0 },
    trail: createTrailState(),
  };
}

export function advanceTerrainTime(time: TerrainTime, elapsed: number, settings: TerrainSettings) {
  const delta = Math.min(elapsed, 0.1);
  const landscapeDelta = settings.terrainMotion ? delta * settings.speed : 0;
  return {
    terrain: time.terrain + landscapeDelta * settings.evolution,
    shimmer: time.shimmer + landscapeDelta,
    checkpoints:
      time.checkpoints +
      (settings.checkpointMotion && settings.trail > 0 ? delta * settings.checkpointSpeed : 0),
  };
}
