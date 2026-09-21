export const terrainRenderProfiles = {
  low: { columns: 256, rows: 160, pixelRatio: 1.5, framesPerSecond: 60 },
  high: { columns: 512, rows: 320, pixelRatio: 2, framesPerSecond: 60 },
};

export type TerrainRenderProfile =
  (typeof terrainRenderProfiles)[keyof typeof terrainRenderProfiles];
