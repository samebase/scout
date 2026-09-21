import { terrainHeight, terrainScale } from "./discovery-terrain";
import { trailNodesPerLeg } from "./terrain-trail";
import { projectTrailNode, type TrailState } from "./terrain-trail-motion";
import { terrainSceneIndex, type TerrainSettings } from "./terrain-settings";

export function pickTrailCheckpoint(
  state: TrailState,
  pointer: { x: number; y: number },
  terrainTime: number,
  settings: TerrainSettings,
  view: Parameters<typeof projectTrailNode>[3],
) {
  if (settings.trail === 0) return null;
  let nearest: { checkpoint: number; x: number; y: number } | null = null;
  let distance = Math.max(18, settings.trailWidth + 10);
  for (let checkpoint = 0; checkpoint < state.homes.length; checkpoint++) {
    const screen = projectTrailNode(
      state.display.nodes[checkpoint * trailNodesPerLeg],
      terrainTime,
      settings,
      view,
    );
    const candidate = Math.hypot(screen.x - pointer.x, screen.y - pointer.y);
    if (candidate < distance) {
      nearest = { checkpoint, ...screen };
      distance = candidate;
    }
  }
  return nearest;
}

export function trailGroundAtPointer(
  pointer: { x: number; y: number },
  terrainTime: number,
  settings: TerrainSettings,
  view: Parameters<typeof projectTrailNode>[3],
) {
  const scale = terrainScale(view.width, view.frameHeight, settings.zoom);
  const yaw = (settings.rotation * Math.PI) / 180;
  const tilt = (settings.tilt * Math.PI) / 180;
  const horizontal = (pointer.x - (view.width * (1 + settings.offsetX)) / 2) / scale;
  const vertical = ((view.frameHeight * (1 - settings.offsetY)) / 2 - pointer.y) / scale;
  const sine = Math.sin(tilt);
  const cosine = Math.cos(tilt);
  const position = (depth: number) => ({
    x: (horizontal * Math.cos(yaw) + depth * Math.sin(yaw)) / settings.spread,
    z: (-horizontal * Math.sin(yaw) + depth * Math.cos(yaw)) / settings.depth,
  });
  const planeDepth = (settings.trailLift * cosine - vertical) / sine;
  const farthestTerrain =
    settings.extent *
    (Math.abs(Math.sin(yaw)) * settings.spread * 5.8 +
      Math.abs(Math.cos(yaw)) * settings.depth * 3.8);
  const minimum = Math.max(planeDepth, -farthestTerrain);
  const maximum = farthestTerrain;
  if (minimum >= maximum) return position(planeDepth);
  const difference = (depth: number) => {
    const point = position(depth);
    const ground = terrainHeight(
      point.x,
      point.z,
      terrainTime,
      settings.peaks,
      settings.extent,
      terrainSceneIndex[settings.scene],
    );
    return ground * settings.elevation + settings.trailLift - (vertical + depth * sine) / cosine;
  };
  // The camera is orthographic. Walk its ray from front to back, then refine the
  // first surface crossing so dragging selects the visible side of a hill.
  const samples = Math.min(
    256,
    Math.max(1, Math.ceil((maximum - minimum) / (0.2 * Math.min(settings.spread, settings.depth)))),
  );
  let front = maximum;
  for (let index = 1; index <= samples; index++) {
    const back = maximum - ((maximum - minimum) * index) / samples;
    if (difference(back) >= 0) {
      let below = back;
      let above = front;
      for (let step = 0; step < 12; step++) {
        const middle = (below + above) / 2;
        if (difference(middle) >= 0) below = middle;
        else above = middle;
      }
      return position((below + above) / 2);
    }
    front = back;
  }
  return position(planeDepth);
}

export function moveTrailCheckpoint(
  state: TrailState,
  checkpoint: number,
  position: { x: number; z: number },
) {
  const index = checkpoint * trailNodesPerLeg;
  const selected = state.nodes[index];
  const dx = position.x - selected.x;
  const dz = position.z - selected.z;
  const visible = state.display.nodes[index];
  const dragX = position.x - visible.x;
  const dragZ = position.z - visible.z;
  // Stretch the visible route immediately around the grabbed checkpoint. Move
  // its tangent handles together and leave the neighboring checkpoints' handles
  // fixed, so dragging cannot introduce a corner at any checkpoint.
  const start = Math.max(0, index - trailNodesPerLeg + 2);
  const end = Math.min(state.display.nodes.length - 1, index + trailNodesPerLeg - 2);
  for (let cursor = start; cursor <= end; cursor++) {
    const t = Math.max(0, Math.abs(cursor - index) - 1) / (trailNodesPerLeg - 2);
    const weight = 1 - t * t * t * (t * (t * 6 - 15) + 10);
    state.display.nodes[cursor].x += dragX * weight;
    state.display.nodes[cursor].z += dragZ * weight;
  }
  visible.x = position.x;
  visible.z = position.z;
  selected.x = position.x;
  selected.z = position.z;
  selected.vx = 0;
  selected.vz = 0;
  state.homes[checkpoint].x += dx;
  state.homes[checkpoint].z += dz;
  state.replan = true;
  state.nextProbe = 0;
}
