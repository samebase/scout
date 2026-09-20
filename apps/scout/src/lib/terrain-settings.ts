import { z } from "zod";

export const terrainSettingsSchema = z.object({
  tilt: z.number().min(10).max(85).default(25.1),
  rotation: z.number().min(-180).max(180).default(31.8),
  zoom: z.number().min(0.25).max(3).default(1.25),
  extent: z.number().min(1).max(3).default(1.9),
  elevation: z.number().min(0.15).max(3).default(0.4),
  peaks: z.number().min(0).max(2).default(1.2),
  spread: z.number().min(0.6).max(4).default(1.6),
  depth: z.number().min(0.6).max(4).default(1.6),
  speed: z.number().min(0).max(8).default(0.1),
  evolution: z.number().min(0).max(3).default(2),
  shimmer: z.number().min(0).max(2).default(2),
  contrast: z.number().min(0.1).max(1).default(1),
  stepHeight: z.number().min(0.04).max(0.3).default(0.09),
  offsetX: z.number().min(-1).max(1).default(0.58),
  offsetY: z.number().min(-1).max(1).default(0.16),
  fade: z.number().min(0).max(1).default(0.3),
  quality: z.enum(["auto", "low", "high"]).default("auto"),
});

export type TerrainSettings = z.infer<typeof terrainSettingsSchema>;
export const atlasTerrainSettings = terrainSettingsSchema.parse({});
export const terrainPresets = [
  { name: "Landing default", settings: atlasTerrainSettings },
  {
    name: "Overhead",
    settings: {
      ...atlasTerrainSettings,
      tilt: 76,
      rotation: -20,
      zoom: 0.8,
      elevation: 0.65,
      offsetX: 0,
      offsetY: -0.12,
      fade: 0,
    },
  },
  {
    name: "Open landscape",
    settings: {
      ...atlasTerrainSettings,
      tilt: 26.6,
      rotation: -4.3,
      zoom: 1.65,
      elevation: 0.4,
      peaks: 1.2,
      spread: 1.6,
      depth: 1.6,
      speed: 0.1,
      evolution: 2,
      shimmer: 2,
      contrast: 1,
      stepHeight: 0.09,
      offsetX: 0,
      offsetY: -0.12,
      fade: 0,
    },
  },
];
