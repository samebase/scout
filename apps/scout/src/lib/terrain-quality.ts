export const terrainRenderProfiles = {
  low: { columns: 128, rows: 80, pixelRatio: 1, framesPerSecond: 30 },
  high: { columns: 256, rows: 160, pixelRatio: 1.5, framesPerSecond: 60 },
};

export type TerrainRenderProfile =
  (typeof terrainRenderProfiles)[keyof typeof terrainRenderProfiles];
