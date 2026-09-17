import tgpu, { common, d, std } from "typegpu";

export async function createDiscoveryField(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const root = await tgpu.init();
  if (signal.aborted) {
    root.destroy();
    return null;
  }
  try {
    const context = root.configureContext({ canvas, alphaMode: "premultiplied" });
    const params = root.createUniform(d.vec3f);
    const pointer = root.createUniform(d.vec2f);
    const pipeline = root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: ({ uv }) => {
        "use gpu";
        const t = params.$.x;
        const aspect = params.$.y;
        const scale = params.$.z;
        const mouse = pointer.$;
        const px = (uv.x - 0.7) * aspect;
        const py = uv.y - 0.51;
        const halo = std.exp(-3.2 * (px * px + py * py));

        const qx = (uv.x - 0.58) * aspect * scale * 2.1 + (mouse.x - 0.5) * 0.2;
        const qy = (uv.y - 0.52) * scale * 2.5 + (mouse.y - 0.5) * 0.2;
        const a = std.sin(qx * 2 + std.sin(qy * 1.5) + t * 0.08);
        const b = std.cos(qy * 2.2 - qx * 0.7 + t * 0.06);
        const h = a * 0.5 + b * 0.3 + std.sin(qx * 4.4 + qy * 3.1) * 0.08;
        const contour = std.pow(0.5 + 0.5 * std.cos(h * 110), 20);
        const sweep = 0.5 + 0.5 * std.sin(t * 0.32);
        const scan = std.exp(-std.pow((uv.x - sweep) * 12, 2));
        const lens = std.exp(-std.pow(std.distance(uv, mouse) * 4, 2));
        const gold = std.pow(0.5 + 0.5 * std.sin(h * 22 + t * 0.23), 50) * scan;
        const ink = std.mix(d.vec3f(0.15, 0.46, 0.34), d.vec3f(0.66, 0.4, 0.1), gold * 0.85);
        const opacity =
          std.clamp(
            contour * (0.24 + scan * 0.55 + lens * 0.24) + gold * 0.25 + halo * 0.035,
            0,
            0.85,
          ) * std.smoothstep(0.22, 0.59, uv.x);
        return d.vec4f(std.mul(ink, opacity), opacity);
      },
    });

    return {
      device: root.device,
      draw(time: number, x: number, y: number) {
        params.write(d.vec3f(time, canvas.width / canvas.height, canvas.clientHeight / 264));
        pointer.write(d.vec2f(x, y));
        pipeline.withColorAttachment({ view: context }).draw(3);
      },
      destroy() {
        context.unconfigure();
        root.destroy();
      },
    };
  } catch (error) {
    root.destroy();
    throw error;
  }
}
