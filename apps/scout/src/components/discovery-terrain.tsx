import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { createDiscoveryField } from "#lib/discovery-field";
import type { TerrainSettings } from "#lib/terrain-settings";
import { terrainRenderProfiles } from "#lib/terrain-quality";
import { advanceTerrainTime, createTerrainAnimation } from "#lib/terrain-motion";
import { inspectTrail, type TrailDiagnosticsFrame } from "#lib/terrain-trail-diagnostics";
import { measureTerrainBounds } from "#lib/terrain-viewport";
import type { TrailObstacle } from "#lib/terrain-trail-motion";
import { projectTrailNode } from "#lib/terrain-trail-motion";
import { trailNodesPerLeg, trailSegments, trailSpline } from "#lib/terrain-trail";
import { d } from "typegpu";
import {
  moveTrailCheckpoint,
  pickTrailCheckpoint,
  trailGroundAtPointer,
} from "#lib/terrain-trail-drag";

export type TerrainStatus = { kind: "ready" } | { kind: "unavailable"; message: string };

export function DiscoveryTerrain({
  paused,
  settings,
  onStatusChange,
  onCameraChange,
  framingRef,
  animationRef,
  onTrailDiagnostics,
  frameRevision = 0,
}: {
  frameRevision?: number;
  onTrailDiagnostics?: (frame: TrailDiagnosticsFrame) => void;
  paused: boolean;
  settings: TerrainSettings;
  onStatusChange?: (status: TerrainStatus) => void;
  onCameraChange?: (tilt: number, rotation: number) => void;
  framingRef?: RefObject<HTMLElement | null>;
  animationRef?: RefObject<ReturnType<typeof createTerrainAnimation>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const checkpointRefs = useRef<(HTMLDivElement | null)[]>([]);
  const refreshRef = useRef<(() => void) | null>(null);
  const [renderState, setRenderState] = useState<"initializing" | "ready" | "unavailable">(
    "initializing",
  );
  const available = renderState === "ready";
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoveredCheckpoint, setHoveredCheckpoint] = useState<number | null>(null);
  const [compactDevice, setCompactDevice] = useState<boolean | null>(null);
  const localAnimationRef = useRef(createTerrainAnimation(settings));
  const animation = animationRef ?? localAnimationRef;
  const quality = settings.quality === "auto" ? (compactDevice ? "low" : "high") : settings.quality;
  const profile = compactDevice === null ? null : terrainRenderProfiles[quality];
  const dragRef = useRef<
    | { kind: "camera"; pointerId: number; x: number; y: number; tilt: number; rotation: number }
    | {
        kind: "checkpoint";
        pointerId: number;
        checkpoint: number;
        offsetX: number;
        offsetY: number;
      }
    | null
  >(null);
  const shouldPause = useEffectEvent(
    () =>
      reducedMotion ||
      paused ||
      dragRef.current?.kind === "checkpoint" ||
      ((!settings.terrainMotion || settings.speed === 0) &&
        (!settings.checkpointMotion || settings.trail === 0)),
  );
  const diagnosticsEnabled = useEffectEvent(() => onTrailDiagnostics !== undefined);
  const reportDiagnostics = useEffectEvent((frame: TrailDiagnosticsFrame) =>
    onTrailDiagnostics?.(frame),
  );
  const currentSettings = useEffectEvent(() => settings);
  const animateTransition = useEffectEvent(() => !reducedMotion);
  const reportStatus = useEffectEvent((status: TerrainStatus) => onStatusChange?.(status));

  function pointerView(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      rect,
      width: rect.width,
      height: rect.height,
      frameHeight: framingRef?.current?.clientHeight ?? canvas.clientHeight,
    };
  }

  function finishDrag() {
    dragRef.current = null;
    setDragging(false);
    refreshRef.current?.();
  }

  function movePointer(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !available) return;
    if (!drag) {
      if (!onCameraChange) return;
      const view = pointerView(canvas);
      setHoveredCheckpoint(
        pickTrailCheckpoint(
          animation.current.trail,
          { x: event.clientX - view.rect.left, y: event.clientY - view.rect.top },
          animation.current.time.terrain,
          settings,
          view,
        )?.checkpoint ?? null,
      );
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    if (drag.kind === "checkpoint") {
      const view = pointerView(canvas);
      const point = trailGroundAtPointer(
        {
          x: event.clientX - view.rect.left + drag.offsetX,
          y: event.clientY - view.rect.top + drag.offsetY,
        },
        animation.current.time.terrain,
        settings,
        view,
      );
      moveTrailCheckpoint(animation.current.trail, drag.checkpoint, point);
      refreshRef.current?.();
      return;
    }
    const tilt = Math.min(85, Math.max(10, drag.tilt + (event.clientY - drag.y) * 0.2));
    const angle = drag.rotation - (event.clientX - drag.x) * 0.25;
    const rotation = (((angle % 360) + 540) % 360) - 180;
    onCameraChange?.(tilt, rotation);
  }

  function releasePointer(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    finishDrag();
  }

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
    setRenderState("initializing");
    if (!navigator.gpu) {
      setRenderState("unavailable");
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
    let lastTransition = 0;
    let frameHeight = 0;
    let lastDiagnostics = 0;
    let pendingFrames = 0;
    let timingStart = 0;
    let timingFrames = 0;
    let timingDraw = 0;
    let timingCompleted = 0;
    let timingCompletion = 0;
    let timing: TrailDiagnosticsFrame["timing"] = null;
    let obstacles: TrailObstacle[] = [];
    let bounds: TrailObstacle = { left: 0, top: 0, right: 0, bottom: 0 };

    function measureObstacles() {
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      bounds = measureTerrainBounds(canvas, frameHeight);
      obstacles = Array.from(
        framingRef?.current?.querySelectorAll("[data-terrain-obstacle]") ?? [],
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left - canvasRect.left,
            right: rect.right - canvasRect.left,
            top: rect.top - canvasRect.top,
            bottom: rect.bottom - canvasRect.top,
          };
        },
      );
    }

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
      setRenderState("unavailable");
      stop();
    }

    function draw(now: number) {
      if (!canvas || !field || disposed || !visible || document.hidden) return;
      const moving = !shouldPause();
      const settings = currentSettings();
      if (animation.current.scene !== settings.scene) {
        animation.current = createTerrainAnimation(settings);
      }
      if (
        (moving || animation.current.trail.display.moving) &&
        last &&
        now - last < 1000 / framesPerSecond - 2
      ) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (pendingFrames >= 2) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (moving) {
        if (last)
          animation.current.time = advanceTerrainTime(
            animation.current.time,
            (now - last) / 1000,
            settings,
          );
      }
      last = now;
      try {
        const drawStart = performance.now();
        field.draw(animation.current.time, settings, frameHeight, {
          state: animation.current.trail,
          obstacles,
          bounds,
          interacting: dragRef.current !== null,
          elapsed: lastTransition ? (now - lastTransition) / 1000 : 0,
          animateTransition: animateTransition(),
        });
        // Match the hit targets to the displayed route, including its speed-limited transition.
        const view = { width: canvas.clientWidth, height: canvas.clientHeight, frameHeight };
        for (let checkpoint = 0; checkpoint < checkpointRefs.current.length; checkpoint++) {
          const handle = checkpointRefs.current[checkpoint];
          const node = animation.current.trail.display.nodes[checkpoint * trailNodesPerLeg];
          if (!handle || !node || view.width === 0 || view.frameHeight === 0) continue;
          const point = projectTrailNode(node, animation.current.time.terrain, settings, view);
          const obscured = obstacles.some(
            (obstacle) =>
              point.x > obstacle.left &&
              point.x < obstacle.right &&
              point.y > obstacle.top &&
              point.y < obstacle.bottom,
          );
          const outside =
            point.x < bounds.left + 22 ||
            point.x > bounds.right - 22 ||
            point.y < bounds.top + 22 ||
            point.y > bounds.bottom - 22;
          const grabbed =
            dragRef.current?.kind === "checkpoint" && dragRef.current.checkpoint === checkpoint;
          handle.style.left = `${point.x}px`;
          handle.style.top = `${point.y}px`;
          handle.style.visibility = grabbed || (!obscured && !outside) ? "visible" : "hidden";
        }
        lastTransition = now;
        const animating = moving || animation.current.trail.display.moving;
        const submittedAt = performance.now();
        pendingFrames++;
        void field.device.queue.onSubmittedWorkDone().then(() => {
          pendingFrames--;
          if (disposed || !field) return;
          if (diagnosticsEnabled()) {
            timingCompleted++;
            timingCompletion += performance.now() - submittedAt;
          }
          if (!drawn) {
            drawn = true;
            setRenderState("ready");
            reportStatus({ kind: "ready" });
          }
        }, fail);
        if (diagnosticsEnabled()) {
          if (!timingStart) timingStart = now;
          timingFrames++;
          timingDraw += submittedAt - drawStart;
          if (now - timingStart >= 1000) {
            timing = {
              framesPerSecond: (timingFrames * 1000) / (now - timingStart),
              drawMilliseconds: timingDraw / timingFrames,
              completionMilliseconds: timingCompleted ? timingCompletion / timingCompleted : null,
            };
            timingStart = now;
            timingFrames = 0;
            timingDraw = 0;
            timingCompleted = 0;
            timingCompletion = 0;
          }
        }
        if (diagnosticsEnabled() && (!animating || now - lastDiagnostics >= 250)) {
          lastDiagnostics = now;
          const rect = canvas.getBoundingClientRect();
          const diagnosticFrame: TrailDiagnosticsFrame = {
            ...inspectTrail(
              animation.current.trail,
              animation.current.time.terrain,
              settings,
              {
                width: rect.width,
                height: rect.height,
                frameHeight,
                bounds,
                obstacles,
                interacting: dragRef.current !== null,
              },
              !animating || settings.scene !== "landscape" ? "surface" : "positions",
            ),
            timing,
            renderError: null,
            viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            bounds,
            obstacles,
          };
          reportDiagnostics(diagnosticFrame);
          if (!animating && settings.trail > 0) {
            const controls = animation.current.trail.display.nodes.map((node) =>
              d.vec2f(node.x, node.z),
            );
            const terrainTime = animation.current.time.terrain;
            const view = { width: rect.width, height: rect.height, frameHeight };
            const capturedAt = lastDiagnostics;
            void field.readRoute().then((rendered) => {
              if (disposed || lastDiagnostics !== capturedAt) return;
              let error = 0;
              for (let index = 0; index <= trailSegments; index++) {
                const progress = (index / trailSegments) * (controls.length - 1);
                const segment = Math.min(Math.floor(progress), controls.length - 2);
                const point = trailSpline(
                  controls[Math.max(0, segment - 1)],
                  controls[segment],
                  controls[segment + 1],
                  controls[Math.min(controls.length - 1, segment + 2)],
                  progress - segment,
                );
                const expected = projectTrailNode(
                  { x: point.x, z: point.y },
                  terrainTime,
                  settings,
                  view,
                );
                error = Math.max(
                  error,
                  Math.hypot(
                    expected.x - ((rendered[index].x + 1) * rect.width) / 2,
                    expected.y - ((1 - rendered[index].y) * rect.height) / 2,
                  ),
                );
              }
              reportDiagnostics({ ...diagnosticFrame, renderError: error });
            }, fail);
          }
        }
        if (moving || (settings.trail > 0 && animation.current.trail.display.moving)) {
          frame = requestAnimationFrame(draw);
        } else {
          lastTransition = 0;
        }
      } catch (error) {
        fail(error);
      }
    }

    function refresh() {
      cancelAnimationFrame(frame);
      last = 0;
      if (!visible || document.hidden) lastTransition = 0;
      timingStart = 0;
      timingFrames = 0;
      timingDraw = 0;
      timingCompleted = 0;
      timingCompletion = 0;
      timing = null;
      measureObstacles();
      if (field && visible && !document.hidden) frame = requestAnimationFrame(draw);
    }

    function resize() {
      if (!canvas) return;
      const ratio = Math.min(window.devicePixelRatio, pixelRatio);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      frameHeight = framingRef?.current?.clientHeight ?? canvas.clientHeight;
      refresh();
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    resizeObserver.observe(canvas);
    if (framingRef?.current) {
      resizeObserver.observe(framingRef.current);
      for (const element of framingRef.current.querySelectorAll("[data-terrain-obstacle]"))
        resizeObserver.observe(element);
    }
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("scroll", measureObstacles, true);
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
      document.removeEventListener("scroll", measureObstacles, true);
      stop();
    };
  }, [profile, framingRef, animation]);

  useEffect(() => {
    refreshRef.current?.();
  }, [reducedMotion, paused, settings, onTrailDiagnostics, frameRevision]);

  return (
    <>
      {renderState === "unavailable" && (
        <picture
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%_-_var(--terrain-tail,0px))] mask-[linear-gradient(to_bottom,black_45%,transparent_100%)]"
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
      )}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 size-full transition-opacity duration-700 ${available ? "opacity-100" : "opacity-0"} ${onCameraChange ? "touch-none" : "pointer-events-none"} ${onCameraChange && available ? (dragging ? "cursor-grabbing" : hoveredCheckpoint !== null ? "cursor-move" : "cursor-grab") : ""}`}
        onPointerDown={(event) => {
          if (!onCameraChange || !available || event.button !== 0 || dragRef.current) return;
          const view = pointerView(event.currentTarget);
          const x = event.clientX - view.rect.left;
          const y = event.clientY - view.rect.top;
          const checkpoint = pickTrailCheckpoint(
            animation.current.trail,
            { x, y },
            animation.current.time.terrain,
            settings,
            view,
          );
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = checkpoint
            ? {
                kind: "checkpoint",
                pointerId: event.pointerId,
                checkpoint: checkpoint.checkpoint,
                offsetX: checkpoint.x - x,
                offsetY: checkpoint.y - y,
              }
            : {
                kind: "camera",
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                tilt: settings.tilt,
                rotation: settings.rotation,
              };
          setDragging(true);
          refreshRef.current?.();
        }}
        onPointerMove={movePointer}
        onPointerUp={releasePointer}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onPointerLeave={() => setHoveredCheckpoint(null)}
      />
      {!onCameraChange &&
        settings.trail > 0 &&
        Array.from({ length: settings.scene === "landscape" ? 4 : 2 }, (_, checkpoint) => (
          <div
            key={checkpoint}
            ref={(element) => {
              checkpointRefs.current[checkpoint] = element;
            }}
            aria-hidden="true"
            title={`Drag checkpoint ${checkpoint + 1}`}
            className={`absolute size-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full cursor-grab active:cursor-grabbing ${available ? "" : "pointer-events-none"}`}
            style={{ visibility: "hidden" }}
            onPointerDown={(event) => {
              const canvas = canvasRef.current;
              const node = animation.current.trail.display.nodes[checkpoint * trailNodesPerLeg];
              if (!canvas || !node || !available || event.button !== 0 || dragRef.current) return;
              event.preventDefault();
              const view = pointerView(canvas);
              const point = projectTrailNode(node, animation.current.time.terrain, settings, view);
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                kind: "checkpoint",
                pointerId: event.pointerId,
                checkpoint,
                offsetX: point.x - (event.clientX - view.rect.left),
                offsetY: point.y - (event.clientY - view.rect.top),
              };
              setDragging(true);
              refreshRef.current?.();
            }}
            onPointerMove={movePointer}
            onPointerUp={releasePointer}
            onPointerCancel={finishDrag}
            onLostPointerCapture={finishDrag}
          />
        ))}
    </>
  );
}
