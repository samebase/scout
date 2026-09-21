import { d } from "typegpu";
import { trailNodesPerLeg, trailSegments, trailSpline } from "./terrain-trail";
import { projectTrailNode, type TrailState, type TrailView } from "./terrain-trail-motion";
import { terrainSceneIndex, type TerrainSettings } from "./terrain-settings";
import { terrainHeight } from "./discovery-terrain";

export function inspectTrail(
  state: TrailState,
  terrainTime: number,
  settings: TerrainSettings,
  view: TrailView,
  detail: "positions" | "surface",
) {
  const count = state.nodes.length;
  const snapshot = { terrainTime, settings, trail: structuredClone(state) };
  const directPath: { x: number; y: number }[] = [];
  if (!count)
    return { checkpoints: [], meanSpeed: 0, relativeSpeed: 0, snapshot, climb: null, directPath };
  const controls = state.display.nodes.map((node) => d.vec2f(node.x, node.z));
  let climb: { route: number; direct: number; required: number } | null = null;
  if (detail === "surface") {
    const height = (point: d.v2f) =>
      terrainHeight(
        point.x,
        point.y,
        terrainTime,
        settings.peaks,
        settings.extent,
        terrainSceneIndex[settings.scene],
      ) * settings.elevation;
    let route = 0;
    let direct = 0;
    let routeY = height(controls[0]);
    let directY = routeY;
    directPath.push(projectTrailNode(state.display.nodes[0], terrainTime, settings, view));
    for (let index = 1; index <= trailSegments; index++) {
      const progress = (index / trailSegments) * (count - 1);
      const segment = Math.min(Math.floor(progress), count - 2);
      const point = trailSpline(
        controls[Math.max(0, segment - 1)],
        controls[segment],
        controls[segment + 1],
        controls[Math.min(count - 1, segment + 2)],
        progress - segment,
      );
      const leg = Math.min(state.homes.length - 2, Math.floor(progress / trailNodesPerLeg));
      const start = controls[leg * trailNodesPerLeg];
      const end = controls[(leg + 1) * trailNodesPerLeg];
      const along = progress / trailNodesPerLeg - leg;
      const directPoint = d.vec2f(
        start.x + (end.x - start.x) * along,
        start.y + (end.y - start.y) * along,
      );
      const nextDirectY = height(directPoint);
      directPath.push(
        projectTrailNode({ x: directPoint.x, z: directPoint.y }, terrainTime, settings, view),
      );
      const nextRouteY = height(point);
      route += Math.max(0, nextRouteY - routeY);
      direct += Math.max(0, nextDirectY - directY);
      routeY = nextRouteY;
      directY = nextDirectY;
    }
    const required = state.homes
      .slice(1)
      .reduce(
        (sum, _, index) =>
          sum +
          Math.max(
            0,
            height(controls[(index + 1) * trailNodesPerLeg]) -
              height(controls[index * trailNodesPerLeg]),
          ),
        0,
      );
    climb = { route, direct, required };
  }
  const checkpoints = Array.from({ length: state.homes.length }, (_, index) => {
    const progress =
      (Math.round((index * trailSegments) / (state.homes.length - 1)) / trailSegments) *
      (count - 1);
    const segment = Math.min(Math.floor(progress), count - 2);
    const position = trailSpline(
      controls[Math.max(0, segment - 1)],
      controls[segment],
      controls[segment + 1],
      controls[Math.min(count - 1, segment + 2)],
      progress - segment,
    );
    const screen = projectTrailNode({ x: position.x, z: position.y }, terrainTime, settings, view);
    const radius = settings.trailWidth + 3;
    const outside = Math.max(
      0,
      view.bounds.left + radius - screen.x,
      screen.x + radius - view.bounds.right,
      view.bounds.top + radius - screen.y,
      screen.y + radius - view.bounds.bottom,
    );
    const covered = view.obstacles.some(
      (box) =>
        screen.x >= box.left &&
        screen.x <= box.right &&
        screen.y >= box.top &&
        screen.y <= box.bottom,
    );
    return { number: index + 1, ...screen, outside, covered };
  });
  const movingPoints = state.homes.map((_, index) => state.nodes[index * trailNodesPerLeg]);
  const meanX = movingPoints.reduce((sum, node) => sum + node.vx, 0) / movingPoints.length;
  const meanZ = movingPoints.reduce((sum, node) => sum + node.vz, 0) / count;
  return {
    snapshot,
    directPath,
    climb,
    checkpoints,
    meanSpeed: Math.hypot(meanX, meanZ),
    relativeSpeed: Math.sqrt(
      movingPoints.reduce((sum, node) => sum + (node.vx - meanX) ** 2 + (node.vz - meanZ) ** 2, 0) /
        movingPoints.length,
    ),
  };
}

export type TrailDiagnosticsFrame = ReturnType<typeof inspectTrail> & {
  renderError: number | null;
  timing: {
    framesPerSecond: number;
    drawMilliseconds: number;
    completionMilliseconds: number | null;
  } | null;
  viewport: { left: number; top: number; width: number; height: number };
  bounds: TrailView["bounds"];
  obstacles: TrailView["obstacles"];
};
