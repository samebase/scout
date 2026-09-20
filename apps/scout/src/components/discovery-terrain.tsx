import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { createDiscoveryField } from "#lib/discovery-field";
import type { TerrainSettings } from "#lib/terrain-settings";
import { terrainRenderProfiles } from "#lib/terrain-quality";

export type TerrainStatus = { kind: "ready" } | { kind: "unavailable"; message: string };

export function DiscoveryTerrain({
  paused,
  settings,
  onStatusChange,
  onCameraChange,
}: {
  paused: boolean;
  settings: TerrainSettings;
  onStatusChange?: (status: TerrainStatus) => void;
  onCameraChange?: (tilt: number, rotation: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const [available, setAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [compactDevice, setCompactDevice] = useState<boolean | null>(null);
  const timeRef = useRef(4);
  const quality = settings.quality === "auto" ? (compactDevice ? "low" : "high") : settings.quality;
  const profile = compactDevice === null ? null : terrainRenderProfiles[quality];
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    tilt: number;
    rotation: number;
  } | null>(null);
  const shouldPause = useEffectEvent(() => reducedMotion || paused || settings.speed === 0);
  const currentSettings = useEffectEvent(() => settings);
  const reportStatus = useEffectEvent((status: TerrainStatus) => onStatusChange?.(status));

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    syncMotion();
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    const media = matchMedia("(max-width: 767px), (pointer: coarse)");
    const syncDevice = () => setCompactDevice(media.matches);
    syncDevice();
    media.addEventListener("change", syncDevice);
    return () => media.removeEventListener("change", syncDevice);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !profile) return;
    const { framesPerSecond, pixelRatio } = profile;
    setAvailable(false);
    if (!navigator.gpu) {
      reportStatus({ kind: "unavailable", message: "This browser does not support WebGPU." });
      return;
    }

    let field: Awaited<ReturnType<typeof createDiscoveryField>> | null = null;
    const initialization = new AbortController();
    let disposed = false;
    let drawn = false;
    let frame = 0;
    let visible = true;
    let last = 0;

    function stop() {
      cancelAnimationFrame(frame);
      field?.destroy();
      field = null;
    }

    function fail(error: unknown) {
      if (disposed) return;
      console.warn("Discovery field unavailable", error);
      reportStatus({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
      setAvailable(false);
      stop();
    }

    function draw(now: number) {
      if (!field || disposed || !visible || document.hidden) return;
      const moving = !shouldPause();
      const settings = currentSettings();
      if (moving && last && now - last < 1000 / framesPerSecond - 2) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (moving) {
        if (last) timeRef.current += Math.min((now - last) / 1000, 0.1) * settings.speed;
      }
      last = now;
      try {
        field.draw(timeRef.current, settings);
        if (!drawn) {
          drawn = true;
          setAvailable(true);
          reportStatus({ kind: "ready" });
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
      const ratio = Math.min(window.devicePixelRatio, pixelRatio);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      refresh();
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", refresh);
    refreshRef.current = refresh;
    resize();

    void import("#lib/discovery-field")
      .then(({ createDiscoveryField }) =>
        createDiscoveryField(canvas, initialization.signal, profile),
      )
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
      document.removeEventListener("visibilitychange", refresh);
      stop();
    };
  }, [profile]);

  useEffect(() => {
    refreshRef.current?.();
  }, [reducedMotion, paused, settings]);

  return (
    <>
      <picture
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${available ? "opacity-0" : "opacity-100"}`}
      >
        <source media="(max-width: 640px)" srcSet="/discovery-terrain-mobile.webp" />
        <img
          src="/discovery-terrain.webp"
          alt=""
          width={2560}
          height={794}
          className="size-full object-fill"
        />
      </picture>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 size-full transition-opacity duration-700 ${available ? "opacity-100" : "opacity-0"} ${onCameraChange ? "touch-none" : ""} ${onCameraChange && available ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
        onPointerDown={(event) => {
          if (!onCameraChange || !available || event.button !== 0 || dragRef.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            tilt: settings.tilt,
            rotation: settings.rotation,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const tilt = Math.min(85, Math.max(10, drag.tilt + (event.clientY - drag.y) * 0.2));
          const angle = drag.rotation - (event.clientX - drag.x) * 0.25;
          const rotation = (((angle % 360) + 540) % 360) - 180;
          onCameraChange?.(tilt, rotation);
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      />
    </>
  );
}
