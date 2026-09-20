export const terrainRenderProfiles = {
  low: { columns: 256, rows: 160, pixelRatio: 1.5, framesPerSecond: 24 },
  high: { columns: 512, rows: 320, pixelRatio: 2, framesPerSecond: 24 },
};

export type TerrainRenderProfile =
  (typeof terrainRenderProfiles)[keyof typeof terrainRenderProfiles];
