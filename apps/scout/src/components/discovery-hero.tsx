import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import type { createDiscoveryField } from "#lib/discovery-field";

export function DiscoveryHero({
  composing,
  children,
}: {
  composing: boolean;
  children: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const [available, setAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const shouldPause = useEffectEvent(() => reducedMotion || composing);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !navigator.gpu) return;

    let field: Awaited<ReturnType<typeof createDiscoveryField>> | null = null;
    const initialization = new AbortController();
    let disposed = false;
    let drawn = false;
    let frame = 0;
    let visible = true;
    let time = 4;
    let last = 0;
    let x = 0.7;
    let y = 0.5;
    let targetX = x;
    let targetY = y;

    function stop() {
      cancelAnimationFrame(frame);
      field?.destroy();
      field = null;
    }

    function fail(error: unknown) {
      if (disposed) return;
      console.warn("Discovery field unavailable", error);
      setAvailable(false);
      stop();
    }

    function draw(now: number) {
      if (!field || disposed || !visible || document.hidden) return;
      const moving = !shouldPause();
      if (moving) {
        if (last) time += Math.min((now - last) / 1000, 0.05);
        x += (targetX - x) * 0.04;
        y += (targetY - y) * 0.04;
      }
      last = now;
      try {
        field.draw(time, x, y);
        if (!drawn) {
          drawn = true;
          setAvailable(true);
        }
        if (moving) frame = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    }

    function refresh() {
      cancelAnimationFrame(frame);
      last = 0;
      if (field && visible && !document.hidden) frame = requestAnimationFrame(draw);
    }

    function resize() {
      if (!canvas) return;
      const ratio = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      refresh();
    }

    function point(event: PointerEvent) {
      if (!canvas || event.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width;
      targetY = (event.clientY - rect.top) / rect.height;
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    canvas.addEventListener("pointermove", point);
    document.addEventListener("visibilitychange", refresh);
    refreshRef.current = refresh;
    resize();

    void import("#lib/discovery-field")
      .then(({ createDiscoveryField }) => createDiscoveryField(canvas, initialization.signal))
      .then((created) => {
        if (!created) return;
        if (disposed) {
          created.destroy();
          return;
        }
        field = created;
        void created.device.lost.then((info) => {
          if (info.reason !== "destroyed") fail(info.message);
        });
        refresh();
      })
      .catch(fail);

    return () => {
      disposed = true;
      initialization.abort();
      refreshRef.current = null;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointermove", point);
      document.removeEventListener("visibilitychange", refresh);
      stop();
    };
  }, []);

  useEffect(() => {
    refreshRef.current?.();
  }, [reducedMotion, composing]);

  return (
    <section
      aria-labelledby="discovery-heading"
      className="relative isolate overflow-hidden bg-background text-foreground"
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-[url('/discovery-field.svg')] bg-[length:100%_100%] bg-center mask-[linear-gradient(to_bottom,black_45%,transparent_100%)] transition-opacity duration-700 ${available ? "opacity-0" : "opacity-100"}`}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 size-full mask-[linear-gradient(to_bottom,black_45%,transparent_100%)] transition-opacity duration-700 ${available ? "opacity-100" : "opacity-0"}`}
      />
      <div className="pointer-events-none relative mx-auto max-w-[1160px] px-8 py-8 max-[640px]:px-4 max-[640px]:py-7">
        <h1
          id="discovery-heading"
          className="font-play-display! text-[64px] leading-[1.02] font-medium tracking-[-0.05em] max-[760px]:text-[52px] max-[640px]:text-[40px]"
        >
          See what lies
          <br />
          beneath the pitch.
        </h1>
      </div>
      <div className="relative mx-auto max-w-[1160px] px-8 max-[640px]:px-4">{children}</div>
    </section>
  );
}
