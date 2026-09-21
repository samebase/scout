import tgpu, { d, std } from "typegpu";
import { projectTerrain, terrainColor, terrainHeight } from "./discovery-terrain";
import { terraceVertex, terraceVertexAddress, verticesPerTerraceBand } from "./terrain-terraces";
import { trailNodeCount, trailPoint, trailSegments, trailSpline } from "./terrain-trail";
import { advanceTrail, type TrailState, type TrailObstacle } from "./terrain-trail-motion";
import { advanceTrailDisplay } from "./terrain-trail-transition";
import type { TerrainTime } from "./terrain-motion";
import { terrainSceneIndex, type TerrainSettings } from "./terrain-settings";
import type { TerrainRenderProfile } from "./terrain-quality";

function triangleIndices(triangle: number, columns: number) {
  "use gpu";
  const width = d.u32(columns);
  const cell = std.intdiv(triangle, 2);
  const start = std.intdiv(cell, width) * (width + 1) + (cell % width);
  const second = triangle % 2 === 1;
  return d.vec3u(
    start + d.u32(second ? width + 1 : 0),
    start + 1,
    start + width + d.u32(second ? 2 : 1),
  );
}

export async function createDiscoveryField(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  profile: TerrainRenderProfile,
) {
  const { columns, rows } = profile;
  const triangleCount = columns * rows * 2;
  const root = await tgpu.init();
  if (signal.aborted) {
    root.destroy();
    return null;
  }
  try {
    const params = root.createUniform(d.vec4f);
    const terrainTime = root.createUniform(d.f32);
    const scene = root.createUniform(d.u32);
    const routeCounts = root.createUniform(d.vec2u);
    const framingHeight = root.createUniform(d.f32);
    const camera = root.createUniform(d.vec3f);
    const shape = root.createUniform(d.vec4f);
    const landscape = root.createUniform(d.vec3f);
    const extent = root.createUniform(d.f32);
    const appearance = root.createUniform(d.vec4f);
    const routeStyle = root.createUniform(d.vec3f);
    const routeControls = root.createBuffer(d.arrayOf(d.vec2f, trailNodeCount)).$usage("storage");
    const controls = routeControls.as("readonly");
    const format = navigator.gpu.getPreferredCanvasFormat();
    const grid = root.createMutable(d.arrayOf(d.vec4f, (columns + 1) * (rows + 1)));
    const points = grid.buffer.as("readonly");
    const route = root.createMutable(d.arrayOf(d.vec3f, trailSegments + 1));
    const routePoints = route.buffer.as("readonly");
    const sampleRoute = root.createGuardedComputePipeline((index) => {
      "use gpu";
      const progress = (d.f32(index) / trailSegments) * d.f32(routeCounts.$.x - 1);
      const segment = std.min(d.u32(progress), routeCounts.$.x - 2);
      const position = trailSpline(
        controls.$[std.max(segment, 1) - 1],
        controls.$[segment],
        controls.$[segment + 1],
        controls.$[std.min(segment + 2, routeCounts.$.x - 1)],
        progress - d.f32(segment),
      );
      const surface = trailPoint(
        position,
        terrainTime.$,
        landscape.$.z,
        extent.$,
        shape.$.x,
        routeStyle.$.z,
        scene.$,
      );
      const world = d.vec3f(surface.x * landscape.$.x, surface.y, surface.z * landscape.$.y);
      route.$[index] = projectTerrain(world, params.$.yz, camera.$, shape.$.yz, framingHeight.$);
    });
    const drawBuffer = root
      .createBuffer(
        d.struct({
          vertexCount: d.atomic(d.u32),
          instanceCount: d.u32,
          firstVertex: d.u32,
          firstInstance: d.u32,
        }),
      )
      .$usage("storage", "indirect");
    const drawArgs = drawBuffer.as("mutable");
    const sampleTerrain = root.createGuardedComputePipeline((index) => {
      "use gpu";
      const x = (d.f32(index % (columns + 1)) / columns - 0.5) * 11.6 * extent.$;
      const z = (d.f32(std.intdiv(index, columns + 1)) / rows - 0.5) * 7.6 * extent.$;
      grid.$[index] = d.vec4f(
        x,
        terrainHeight(x, z, terrainTime.$, landscape.$.z, extent.$, scene.$),
        z,
        0,
      );
    });
    const sizeTerraces = root.createGuardedComputePipeline((triangle) => {
      "use gpu";
      const indices = triangleIndices(triangle, columns);
      const a = points.$[indices.x].y;
      const b = points.$[indices.y].y;
      const c = points.$[indices.z].y;
      const first = std.floor(std.min(a, std.min(b, c)) / shape.$.w);
      const last = std.floor(std.max(a, std.max(b, c)) / shape.$.w);
      std.atomicMax(
        drawArgs.$.vertexCount,
        d.u32(last - first + 1) * triangleCount * verticesPerTerraceBand,
      );
    });
    const pipeline = root.createRenderPipeline({
      targets: { format },
      multisample: { count: 4 },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      vertex: ({ $vertexIndex }) => {
        "use gpu";
        const address = terraceVertexAddress($vertexIndex, triangleCount);
        const band = address.y;
        const vertex = address.z;
        const indices = triangleIndices(address.x, columns);
        let low = d.vec3f(points.$[indices.x].xyz);
        let middle = d.vec3f(points.$[indices.y].xyz);
        let high = d.vec3f(points.$[indices.z].xyz);
        if (low.y > middle.y) {
          const swap = d.vec3f(low);
          low = d.vec3f(middle);
          middle = d.vec3f(swap);
        }
        if (middle.y > high.y) {
          const swap = d.vec3f(middle);
          middle = d.vec3f(high);
          high = d.vec3f(swap);
        }
        if (low.y > middle.y) {
          const swap = d.vec3f(low);
          low = d.vec3f(middle);
          middle = d.vec3f(swap);
        }
        const level = (std.floor(low.y / shape.$.w) + d.f32(band)) * shape.$.w;
        const terrace = terraceVertex(low, middle, high, level, shape.$.w, vertex);
        const surface = d.vec3f(terrace.x, terrace.y * shape.$.x, terrace.z);
        const world = d.vec3f(surface.x * landscape.$.x, surface.y, surface.z * landscape.$.y);
        let normal = d.vec3f(0, 1, 0);
        if (vertex >= 12 && high.y > low.y) {
          const slope = std.cross(std.sub(high, low), std.sub(middle, low));
          normal = std.normalize(d.vec3f(slope.x / landscape.$.x, 0, slope.z / landscape.$.y));
          if (slope.y < 0) normal = std.mul(normal, -1);
        }
        const projected = projectTerrain(world, params.$.yz, camera.$, shape.$.yz, framingHeight.$);
        return {
          $position: d.vec4f(projected, 1),
          surface,
          normal,
          surfaceHeight: terrace.w,
        };
      },
      fragment: ({ surface, normal, surfaceHeight, $position }) => {
        "use gpu";
        return terrainColor(
          surface,
          normal,
          surfaceHeight,
          std.fwidth(surfaceHeight / appearance.$.x) * 0.65,
          params.$.x,
          $position.x / params.$.w,
          appearance.$,
          extent.$,
        );
      },
    });
    const routePipeline = root.createRenderPipeline({
      targets: {
        format,
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      },
      multisample: { count: 4 },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
      vertex: ({ $vertexIndex }) => {
        "use gpu";
        const corner = $vertexIndex % 6;
        const right = corner === 1 || corner === 2 || corner === 4;
        const upper = corner === 2 || corner === 4 || corner === 5;
        const uv = d.vec2f(right ? 1 : -1, upper ? 1 : -1);
        const checkpoint = $vertexIndex >= trailSegments * 6;
        let position = d.vec3f(0);
        let along = d.f32(0);
        let length = d.f32(0);
        const radius = routeStyle.$.y * 0.5 + 0.75;
        if (checkpoint) {
          const marker = std.intdiv($vertexIndex - trailSegments * 6, 6);
          const index = d.u32(
            std.round((d.f32(marker) * trailSegments) / d.f32(routeCounts.$.y - 1)),
          );
          position = d.vec3f(routePoints.$[index]);
          const radius = routeStyle.$.y + 3;
          position.x += (uv.x * radius * 2) / params.$.y;
          position.y += (uv.y * radius * 2) / params.$.z;
        } else {
          const index = std.intdiv($vertexIndex, 6);
          const start = routePoints.$[index];
          const end = routePoints.$[index + 1];
          const delta = std.mul(std.sub(end.xy, start.xy), std.mul(params.$.yz, 0.5));
          length = std.length(delta);
          let tangent = d.vec2f(1, 0);
          if (length > 0.0001) tangent = std.div(delta, length);
          const normal = d.vec2f(-tangent.y, tangent.x);
          position = d.vec3f(start);
          if (right) position = d.vec3f(end);
          along = right ? length + radius : -radius;
          // Each segment is a round capsule. A projected reversal can overlap
          // cleanly instead of folding a shared ribbon normal into a spike.
          position.x += ((tangent.x * uv.x + normal.x * uv.y) * radius * 2) / params.$.y;
          position.y += ((tangent.y * uv.x + normal.y * uv.y) * radius * 2) / params.$.z;
        }
        return {
          $position: d.vec4f(position, 1),
          uv,
          along,
          length,
          checkpoint: d.f32(checkpoint),
        };
      },
      fragment: ({ uv, along, length, checkpoint, $position }) => {
        "use gpu";
        const beyond = std.max(0, std.max(-along, along - length));
        const radius = routeStyle.$.y * 0.5 + 0.75;
        const distance = std.mix(
          std.length(d.vec2f(beyond / radius, uv.y)),
          std.length(uv),
          checkpoint,
        );
        const feather = std.fwidth(distance);
        const coverage = 1 - std.smoothstep(1 - feather, 1, distance);
        const orange = d.vec3f(0.94, 0.36, 0.09);
        const centre = (1 - std.smoothstep(0.5, 0.5 + feather, distance)) * checkpoint;
        const color = std.mix(orange, d.vec3f(1, 0.99, 0.97), centre);
        const fade = std.mix(
          1,
          std.smoothstep(0.26, 0.52, $position.x / params.$.w),
          appearance.$.w,
        );
        const opacity = coverage * routeStyle.$.x * fade;
        return d.vec4f(std.mul(color, opacity), opacity);
      },
    });
    await Promise.all([
      sampleTerrain.initAsync(),
      sizeTerraces.initAsync(),
      pipeline.initAsync(),
      sampleRoute.initAsync(),
      routePipeline.initAsync(),
    ]);
    if (signal.aborted) {
      root.destroy();
      return null;
    }
    const context = root.configureContext({ canvas, alphaMode: "premultiplied" });
    const createAttachments = () => ({
      depth: root
        .createTexture({
          size: [canvas.width, canvas.height],
          format: "depth24plus",
          sampleCount: 4,
        })
        .$usage("render"),
      color: root
        .createTexture({ size: [canvas.width, canvas.height], format, sampleCount: 4 })
        .$usage("render"),
    });
    let attachments = createAttachments();

    return {
      device: root.device,
      readRoute: () => route.buffer.read(),
      draw(
        time: TerrainTime,
        settings: TerrainSettings,
        frameHeight: number,
        motion: {
          state: TrailState;
          obstacles: TrailObstacle[];
          bounds: TrailObstacle;
          interacting: boolean;
          elapsed: number;
          animateTransition: boolean;
        },
      ) {
        if (
          attachments.depth.props.size[0] !== canvas.width ||
          attachments.depth.props.size[1] !== canvas.height
        ) {
          attachments.depth.destroy();
          attachments.color.destroy();
          attachments = createAttachments();
        }
        params.write(d.vec4f(time.shimmer, canvas.clientWidth, canvas.clientHeight, canvas.width));
        terrainTime.write(time.terrain);
        scene.write(terrainSceneIndex[settings.scene]);
        if (settings.trail > 0) {
          advanceTrail(motion.state, time, settings, {
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            frameHeight,
            obstacles: motion.obstacles,
            bounds: motion.bounds,
            interacting: motion.interacting,
          });
          advanceTrailDisplay(motion.state, settings, motion.elapsed, motion.animateTransition);
          routeCounts.write(d.vec2u(motion.state.nodes.length, motion.state.homes.length));
          routeControls.write(
            Array.from({ length: trailNodeCount }, (_, index) => {
              const node =
                motion.state.display.nodes[Math.min(index, motion.state.nodes.length - 1)];
              return d.vec2f(node.x, node.z);
            }),
          );
        }
        framingHeight.write(frameHeight);
        camera.write(
          d.vec3f(
            (settings.tilt * Math.PI) / 180,
            (settings.rotation * Math.PI) / 180,
            settings.zoom,
          ),
        );
        shape.write(
          d.vec4f(settings.elevation, settings.offsetX, settings.offsetY, settings.stepHeight),
        );
        landscape.write(d.vec3f(settings.spread, settings.depth, settings.peaks));
        extent.write(settings.extent);
        appearance.write(
          d.vec4f(settings.stepHeight, settings.contrast, settings.shimmer, settings.fade),
        );
        routeStyle.write(d.vec3f(settings.trail, settings.trailWidth, settings.trailLift));
        drawBuffer.write({ vertexCount: 0, instanceCount: 1, firstVertex: 0, firstInstance: 0 });
        sampleTerrain.dispatchThreads((columns + 1) * (rows + 1));
        sizeTerraces.dispatchThreads(triangleCount);
        if (settings.trail > 0) {
          sampleRoute.dispatchThreads(trailSegments + 1);
        }
        const encoder = root["~unstable"].createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: attachments.color.createView("render"),
              resolveTarget: context,
              clearValue: [0, 0, 0, 0],
              storeOp: "discard",
            },
          ],
          depthStencilAttachment: {
            view: attachments.depth.createView("render"),
            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "discard",
          },
        });
        pipeline.with(pass).drawIndirect(drawBuffer);
        if (settings.trail > 0) {
          routePipeline.with(pass).draw((trailSegments + motion.state.homes.length) * 6);
        }
        pass.end();
        encoder.submit();
      },
      destroy() {
        attachments.depth.destroy();
        attachments.color.destroy();
        context.unconfigure();
        root.destroy();
      },
    };
  } catch (error) {
    root.destroy();
    throw error;
  }
}
