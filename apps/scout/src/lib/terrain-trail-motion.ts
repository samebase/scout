import { d } from "typegpu";
import { projectTerrain, terrainHeight, terrainScale } from "./discovery-terrain";
import { createTrailSurface, planTrail } from "./terrain-trail-routing";
import { roundTrailCheckpoints } from "./terrain-trail-joins";
import { trailNodesPerLeg, trailPoint, trailSpline } from "./terrain-trail";
import type { TerrainTime } from "./terrain-motion";
import { terrainSceneIndex, type TerrainSettings } from "./terrain-settings";

type TrailNode = { x: number; z: number; vx: number; vz: number };
export type TrailObstacle = { left: number; top: number; right: number; bottom: number };
export type TrailState = {
  nodes: TrailNode[];
  display: { nodes: { x: number; z: number }[]; moving: boolean };
  homes: { x: number; z: number }[];
  span: number;
  time: number;
  avoidance: number;
  pressure: { x: number; z: number }[];
  nextProbe: number;
  plannedInput: string;
  terrainTime: number;
  replan: boolean;
  terrainShape: string;
};
export type TrailView = {
  width: number;
  height: number;
  frameHeight: number;
  bounds: TrailObstacle;
  obstacles: TrailObstacle[];
  interacting: boolean;
};

export function createTrailState(): TrailState {
  return {
    nodes: [],
    display: { nodes: [], moving: false },
    homes: [],
    span: 0,
    time: 0,
    avoidance: 0,
    pressure: [],
    nextProbe: 0,
    plannedInput: "",
    terrainTime: 0,
    replan: false,
    terrainShape: "",
  };
}

function wander(time: number, seed: number) {
  const cell = Math.floor(time);
  const fraction = time - cell;
  const blend = fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
  const sample = (index: number) => {
    const hash = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
    return (hash - Math.floor(hash)) * 2 - 1;
  };
  return sample(cell) * (1 - blend) + sample(cell + 1) * blend;
}

export function projectTrailNode(
  node: Pick<TrailNode, "x" | "z">,
  terrainTime: number,
  settings: TerrainSettings,
  view: Pick<TrailView, "width" | "height" | "frameHeight">,
) {
  const surface = trailPoint(
    d.vec2f(node.x, node.z),
    terrainTime,
    settings.peaks,
    settings.extent,
    settings.elevation,
    settings.trailLift,
    terrainSceneIndex[settings.scene],
  );
  return projectTrailSurface(surface, settings, view);
}

function projectTrailSurface(
  surface: d.v3f,
  settings: TerrainSettings,
  view: Pick<TrailView, "width" | "height" | "frameHeight">,
) {
  const clip = projectTerrain(
    d.vec3f(surface.x * settings.spread, surface.y, surface.z * settings.depth),
    d.vec2f(view.width, view.height),
    d.vec3f((settings.tilt * Math.PI) / 180, (settings.rotation * Math.PI) / 180, settings.zoom),
    d.vec2f(settings.offsetX, settings.offsetY),
    view.frameHeight,
  );
  return { x: ((clip.x + 1) * view.width) / 2, y: ((1 - clip.y) * view.height) / 2 };
}

function obstaclePush(x: number, y: number, box: TrailObstacle) {
  const dx = x - Math.max(box.left, Math.min(box.right, x));
  const dy = y - Math.max(box.top, Math.min(box.bottom, y));
  const distance = Math.hypot(dx, dy);
  if (distance > 0) {
    const strength = Math.max(0, 1 - distance / 48) ** 2;
    return { x: (dx / distance) * strength, y: (dy / distance) * strength };
  }
  const exits = [
    { distance: x - box.left, x: -1, y: 0 },
    { distance: box.right - x, x: 1, y: 0 },
    { distance: y - box.top, x: 0, y: -1 },
    { distance: box.bottom - y, x: 0, y: 1 },
  ];
  return exits.reduce((nearest, exit) => (exit.distance < nearest.distance ? exit : nearest));
}

function visibilityForce(
  node: TrailNode,
  surface: d.v3f,
  alongX: d.v3f,
  alongZ: d.v3f,
  settings: TerrainSettings,
  view: TrailView,
) {
  const screen = projectTrailSurface(surface, settings, view);
  const screenX = projectTrailSurface(alongX, settings, view);
  const screenZ = projectTrailSurface(alongZ, settings, view);
  const epsilon = alongX.x - surface.x;
  const scale = Math.max(1, terrainScale(view.width, view.frameHeight, settings.zoom));
  const ax = (screenX.x - screen.x) / (epsilon * scale);
  const ay = (screenX.y - screen.y) / (epsilon * scale);
  const bx = (screenZ.x - screen.x) / (epsilon * scale);
  const by = (screenZ.y - screen.y) / (epsilon * scale);
  const margin = Math.min(
    80,
    (view.bounds.right - view.bounds.left) * 0.18,
    (view.bounds.bottom - view.bounds.top) * 0.18,
  );
  const predictedX = screen.x + (ax * node.vx + bx * node.vz) * scale * 1.5;
  const predictedY = screen.y + (ay * node.vx + by * node.vz) * scale * 1.5;
  const edgeX =
    Math.max(0, view.bounds.left + margin - predictedX) -
    Math.max(0, predictedX - view.bounds.right + margin);
  const edgeY =
    Math.max(0, view.bounds.top + margin - predictedY) -
    Math.max(0, predictedY - view.bounds.bottom + margin);
  let contentX = 0;
  let contentY = 0;
  for (const box of view.obstacles) {
    const push = obstaclePush(screen.x, screen.y, box);
    contentX += push.x * 0.045;
    contentY += push.y * 0.045;
  }
  // Start braking before the edge. Content remains a mild preference; it cannot
  // cancel the stronger inward force at a viewport boundary.
  const x = edgeX !== 0 ? (edgeX / scale) * 1.8 : contentX;
  const y = edgeY !== 0 ? (edgeY / scale) * 1.8 : contentY;
  const aa = ax * ax + ay * ay + 0.08;
  const bb = bx * bx + by * by + 0.08;
  const ab = ax * bx + ay * by;
  const determinant = aa * bb - ab * ab;
  const right = ax * x + ay * y;
  const forward = bx * x + by * y;
  return {
    x: (bb * right - ab * forward) / determinant,
    z: (aa * forward - ab * right) / determinant,
  };
}

const surfaces = new WeakMap<
  TrailState,
  { key: string; surface: ReturnType<typeof createTrailSurface> }
>();

export function resetTrailConnection(state: TrailState, settings: TerrainSettings) {
  if (!state.nodes.length) return;
  const checkpoints = state.homes.map((_, index) => state.nodes[index * trailNodesPerLeg]);
  const controls = checkpoints.map((p) => d.vec2f(p.x, p.z));
  state.nodes.forEach((node, index) => {
    if (index % trailNodesPerLeg === 0) return;
    const leg = Math.floor(index / trailNodesPerLeg);
    const point = trailSpline(
      controls[Math.max(0, leg - 1)],
      controls[leg],
      controls[leg + 1],
      controls[Math.min(controls.length - 1, leg + 2)],
      (index % trailNodesPerLeg) / trailNodesPerLeg,
    );
    node.x = point.x;
    node.z = point.y;
    node.vx = 0;
    node.vz = 0;
  });
  state.nodes = roundTrailCheckpoints(state.nodes, settings);
  state.plannedInput = routeInput(state);
  state.replan = false;
}

function routeInput(state: TrailState) {
  return JSON.stringify([
    state.terrainTime,
    state.terrainShape,
    state.homes.map((_, index) => {
      const point = state.nodes[index * trailNodesPerLeg];
      return [point.x, point.z];
    }),
  ]);
}

function replanTrailConnection(state: TrailState, settings: TerrainSettings) {
  const checkpoints = state.homes.map((_, index) => state.nodes[index * trailNodesPerLeg]);
  const input = routeInput(state);
  if (!state.replan && input === state.plannedInput) return;
  const key = JSON.stringify([state.terrainTime, state.terrainShape]);
  const previous = surfaces.get(state);
  let surface: ReturnType<typeof createTrailSurface>;
  if (
    !previous ||
    previous.key !== key ||
    checkpoints.some(
      (p) =>
        p.x < previous.surface.left ||
        p.x > previous.surface.right ||
        p.z < previous.surface.top ||
        p.z > previous.surface.bottom,
    )
  ) {
    const height = (x: number, z: number) =>
      terrainHeight(
        x,
        z,
        state.terrainTime,
        settings.peaks,
        settings.extent,
        terrainSceneIndex[settings.scene],
      ) * settings.elevation;
    surface = createTrailSurface(height, settings, checkpoints);
    surfaces.set(state, { key, surface });
  } else {
    surface = previous.surface;
  }
  const route = planTrail(checkpoints, surface, settings);
  state.nodes.forEach((node, index) => {
    if (index % trailNodesPerLeg === 0) return;
    node.x = route[index].x;
    node.z = route[index].z;
    node.vx = 0;
    node.vz = 0;
  });
  state.plannedInput = input;
  state.replan = false;
}

export function advanceTrail(
  state: TrailState,
  time: TerrainTime,
  settings: TerrainSettings,
  view: TrailView,
) {
  if (state.nodes.length === 0) {
    state.span = settings.scene === "landscape" ? 4.6 * settings.extent : 6;
    state.homes =
      settings.scene === "landscape"
        ? [0.25, 0.6, -0.1, 0.25].map((x, index) => ({
            x: x * settings.extent,
            z: (index / 3 - 0.5) * state.span,
          }))
        : [
            { x: -3, z: 0 },
            { x: 3, z: 0 },
          ];
    state.nodes = Array.from(
      { length: (state.homes.length - 1) * trailNodesPerLeg + 1 },
      (_, index) => {
        if (index % trailNodesPerLeg === 0) {
          const home = state.homes[index / trailNodesPerLeg];
          return { x: home.x, z: home.z, vx: 0, vz: 0 };
        }
        const leg = Math.floor(index / trailNodesPerLeg);
        const start = state.homes[leg];
        const end = state.homes[leg + 1];
        const progress = (index % trailNodesPerLeg) / trailNodesPerLeg;
        return {
          x: start.x + (end.x - start.x) * progress,
          z: start.z + (end.z - start.z) * progress,
          vx: 0,
          vz: 0,
        };
      },
    );
    state.pressure = state.nodes.map(() => ({ x: 0, z: 0 }));
    state.replan = true;
  }
  state.terrainTime = time.terrain;
  state.terrainShape = JSON.stringify([
    settings.scene,
    settings.peaks,
    settings.extent,
    settings.elevation,
    settings.spread,
    settings.depth,
  ]);
  const elapsed = settings.checkpointMotion
    ? Math.max(0, Math.min(0.3, time.checkpoints - state.time))
    : 0;
  state.time = time.checkpoints;
  if (elapsed > 0) advanceCheckpoints(state, time, settings, view, elapsed);
  else if (!settings.checkpointMotion) {
    for (let index = 0; index < state.nodes.length; index += trailNodesPerLeg) {
      state.nodes[index].vx = 0;
      state.nodes[index].vz = 0;
    }
  }
  // Solve immediately. The renderer advances the displayed curve separately.
  replanTrailConnection(state, settings);
  if (state.display.nodes.length === 0) {
    state.display.nodes = state.nodes.map(({ x, z }) => ({ x, z }));
  }
}

function advanceCheckpoints(
  state: TrailState,
  time: TerrainTime,
  settings: TerrainSettings,
  view: TrailView,
  elapsed: number,
) {
  const steps = Math.max(1, Math.ceil(elapsed * 60 - 1e-8));
  const delta = elapsed / steps;
  const steering =
    settings.checkpointAvoidance &&
    !view.interacting &&
    view.bounds.right > view.bounds.left &&
    view.bounds.bottom > view.bounds.top;
  if (steering && time.checkpoints >= state.nextProbe) {
    for (let index = 0; index < state.nodes.length; index += trailNodesPerLeg) {
      const node = state.nodes[index];
      const epsilon = 0.015;
      const ground = (x: number, z: number) =>
        trailPoint(
          d.vec2f(x, z),
          time.terrain,
          settings.peaks,
          settings.extent,
          settings.elevation,
          settings.trailLift,
          terrainSceneIndex[settings.scene],
        );
      const surface = ground(node.x, node.z);
      const alongX = ground(node.x + epsilon, node.z);
      const alongZ = ground(node.x, node.z + epsilon);
      state.pressure[index] = visibilityForce(node, surface, alongX, alongZ, settings, view);
    }
    state.nextProbe = time.checkpoints + 0.25 * settings.checkpointSpeed;
  }
  for (let step = 0; step < steps; step++) {
    const now = time.checkpoints - elapsed + (step + 1) * delta;
    state.avoidance += ((steering ? 1 : 0) - state.avoidance) * (1 - Math.exp(-delta / 2.5));
    const first = state.nodes[0];
    const lastIndex = state.nodes.length - 1;
    const last = state.nodes[lastIndex];
    const span = Math.max(0.001, Math.hypot(last.x - first.x, last.z - first.z));
    const axisX = (last.x - first.x) / span;
    const axisZ = (last.z - first.z) / span;
    const separationSpeed = (last.vx - first.vx) * axisX + (last.vz - first.vz) * axisZ;
    const opening =
      settings.checkpointDrift > 0
        ? Math.min(0.24, Math.max(0, state.span * 0.7 - span - separationSpeed * 1.5) * 0.12)
        : 0;
    for (let index = 0; index < state.nodes.length; index += trailNodesPerLeg) {
      const node = state.nodes[index];
      let x = steering ? state.pressure[index].x * state.avoidance : 0;
      let z = steering ? state.pressure[index].z * state.avoidance : 0;
      if (index === 0 || index === lastIndex) {
        const direction = index === 0 ? -1 : 1;
        x += axisX * opening * direction;
        z += axisZ * opening * direction;
      }
      const marker = index / trailNodesPerLeg;
      const home = state.homes[marker];
      const movement = (settings.checkpointDrift * state.span) / 4.6;
      const targetX = home.x + wander(now * 0.11 + marker * 2.7, marker + 20) * movement * 0.85;
      const targetZ = home.z + wander(now * 0.085 + marker * 3.1, marker + 40) * movement * 0.25;
      x += (targetX - node.x) * 0.22;
      z += (targetZ - node.z) * 0.22;
      const limit = Math.max(1, Math.hypot(x, z) / 0.65);
      const damping = Math.exp(-1.4 * delta);
      node.vx = (node.vx + (x / limit) * delta) * damping;
      node.vz = (node.vz + (z / limit) * delta) * damping;
      node.x += node.vx * delta;
      node.z += node.vz * delta;
    }
  }
}
