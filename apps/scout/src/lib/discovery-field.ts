import tgpu, { d, std } from "typegpu";
import { projectTerrain, terrainColor, terrainHeight } from "./discovery-terrain";
import { terraceVertex } from "./terrain-terraces";
import type { TerrainSettings } from "./terrain-settings";
import type { TerrainRenderProfile } from "./terrain-quality";

const verticesPerBand = 18;

function triangleIndices(triangle: number, columns: number) {
  "use gpu";
  const width = d.u32(columns);
  const cell = d.u32(triangle / 2);
  const start = d.u32(cell / width) * (width + 1) + (cell % width);
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
    const camera = root.createUniform(d.vec3f);
    const shape = root.createUniform(d.vec4f);
    const landscape = root.createUniform(d.vec4f);
    const extent = root.createUniform(d.f32);
    const appearance = root.createUniform(d.vec4f);
    const format = navigator.gpu.getPreferredCanvasFormat();
    const grid = root.createMutable(d.arrayOf(d.vec4f, (columns + 1) * (rows + 1)));
    const points = grid.buffer.as("readonly");
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
      const z = (d.f32(d.u32(index / (columns + 1))) / rows - 0.5) * 7.6 * extent.$;
      grid.$[index] = d.vec4f(
        x,
        terrainHeight(x, z, params.$.x * landscape.$.z, landscape.$.w, extent.$),
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
        d.u32(last - first + 1) * triangleCount * verticesPerBand,
      );
    });
    const pipeline = root.createRenderPipeline({
      targets: { format },
      multisample: { count: 4 },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      vertex: ({ $vertexIndex }) => {
        "use gpu";
        const triangle = d.u32($vertexIndex / verticesPerBand) % triangleCount;
        const band = d.u32($vertexIndex / (verticesPerBand * triangleCount));
        const vertex = $vertexIndex % verticesPerBand;
        const indices = triangleIndices(triangle, columns);
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
        const projected = projectTerrain(world, params.$.yz, camera.$, shape.$.yz);
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
    await Promise.all([sampleTerrain.initAsync(), sizeTerraces.initAsync(), pipeline.initAsync()]);
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
      draw(time: number, settings: TerrainSettings) {
        if (
          attachments.depth.props.size[0] !== canvas.width ||
          attachments.depth.props.size[1] !== canvas.height
        ) {
          attachments.depth.destroy();
          attachments.color.destroy();
          attachments = createAttachments();
        }
        params.write(d.vec4f(time, canvas.clientWidth, canvas.clientHeight, canvas.width));
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
        landscape.write(
          d.vec4f(settings.spread, settings.depth, settings.evolution, settings.peaks),
        );
        extent.write(settings.extent);
        appearance.write(
          d.vec4f(settings.stepHeight, settings.contrast, settings.shimmer, settings.fade),
        );
        drawBuffer.write({ vertexCount: 0, instanceCount: 1, firstVertex: 0, firstInstance: 0 });
        sampleTerrain.dispatchThreads((columns + 1) * (rows + 1));
        sizeTerraces.dispatchThreads(triangleCount);
        pipeline
          .withColorAttachment({
            view: attachments.color.createView("render"),
            resolveTarget: context,
            clearValue: [0, 0, 0, 0],
            storeOp: "discard",
          })
          .withDepthStencilAttachment({
            view: attachments.depth.createView("render"),
            depthClearValue: 1,
            depthLoadOp: "clear",
            depthStoreOp: "discard",
          })
          .drawIndirect(drawBuffer);
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
