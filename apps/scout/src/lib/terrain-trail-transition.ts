import { d } from "typegpu";
import type { TerrainSettings } from "./terrain-settings";
import { trailSegments, trailSpline } from "./terrain-trail";
import type { TrailState } from "./terrain-trail-motion";

export function advanceTrailDisplay(
  state: TrailState,
  settings: TerrainSettings,
  elapsed: number,
  animate: boolean,
) {
  const { display } = state;
  let longest = 0;
  for (let index = 0; index < state.nodes.length; index++) {
    const target = state.nodes[index];
    const point = display.nodes[index];
    longest = Math.max(
      longest,
      Math.hypot((target.x - point.x) * settings.spread, (target.z - point.z) * settings.depth),
    );
  }
  display.moving = longest > 0;
  if (!display.moving) return;
  if (!animate) {
    display.nodes = state.nodes.map(({ x, z }) => ({ x, z }));
    display.moving = false;
    return;
  }
  const distance = settings.routeMaxSpeed * Math.max(0, Math.min(elapsed, 0.1));
  if (distance === 0) return;

  const before = sampleGroundPlane(display.nodes, settings);
  let fraction = Math.min(1, distance / longest);
  // Move the controls together to preserve a smooth spline. Check every rendered
  // vertex's horizontal movement, rather than only the control points. Height is
  // sampled from the current terrain by the renderer and is never speed-limited.
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = display.nodes.map((point, index) => ({
      x: point.x + (state.nodes[index].x - point.x) * fraction,
      z: point.z + (state.nodes[index].z - point.z) * fraction,
    }));
    const after = sampleGroundPlane(candidate, settings);
    let farthest = 0;
    for (let index = 0; index < before.length; index++) {
      farthest = Math.max(
        farthest,
        Math.hypot(after[index].x - before[index].x, after[index].z - before[index].z),
      );
    }
    if (farthest <= distance) {
      display.nodes = fraction === 1 ? state.nodes.map(({ x, z }) => ({ x, z })) : candidate;
      display.moving = fraction < 1;
      return;
    }
    fraction *= (distance / farthest) * 0.999;
  }
}

function sampleGroundPlane(nodes: { x: number; z: number }[], settings: TerrainSettings) {
  const controls = nodes.map((point) => d.vec2f(point.x, point.z));
  return Array.from({ length: trailSegments + 1 }, (_, index) => {
    const progress = (index / trailSegments) * (controls.length - 1);
    const segment = Math.min(Math.floor(progress), controls.length - 2);
    const point = trailSpline(
      controls[Math.max(0, segment - 1)],
      controls[segment],
      controls[segment + 1],
      controls[Math.min(controls.length - 1, segment + 2)],
      progress - segment,
    );
    return {
      x: point.x * settings.spread,
      z: point.y * settings.depth,
    };
  });
}
