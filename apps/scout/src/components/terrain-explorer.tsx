import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import { LinkIcon, PauseIcon, PlayIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import {
  defaultTerrainSettings,
  routeExperimentSettings,
  terrainPresets,
  terrainSettingsSchema,
  type TerrainSettings,
} from "#lib/terrain-settings";
import { createTerrainAnimation } from "#lib/terrain-motion";
import { resetTrailConnection } from "#lib/terrain-trail-motion";
import { DiscoveryTerrain, type TerrainStatus } from "./discovery-terrain";
import { omitNullish } from "../../shared/omitNullish";
import { TrailDiagnostics } from "./trail-diagnostics";
import type { TrailDiagnosticsFrame } from "#lib/terrain-trail-diagnostics";
import { DiscoveryHero } from "./discovery-hero";
import { ActivityFeed } from "./activity-feed";
import { ConversationLobby } from "../products/conversation/page";
import { Button } from "./ui/button";
import { useLocalStorageSidebarState } from "../sidebars/scoutSidebarState";

const sidebarDefaults = {
  leftDesktopOpen: true,
  leftDesktopWidthPx: 288,
  leftMobileWidthPx: 288,
  mobilePane: "main",
  mobileSurface: { kind: "unmerged" },
  rightDesktopOpen: false,
  rightDesktopWidthPx: 0,
  rightMobileWidthPx: 0,
} satisfies SidebarLayoutState;

const controlGroups = [
  {
    title: "Camera",
    controls: [
      { key: "tilt", label: "View from above", min: 10, max: 85, step: 0.1, unit: "°" },
      { key: "rotation", label: "Rotation", min: -180, max: 180, step: 0.1, unit: "°" },
      { key: "zoom", label: "Zoom", min: 0.25, max: 3, step: 0.05, unit: "×" },
    ],
  },
  {
    title: "Route",
    controls: [
      { key: "trail", label: "Route visibility", min: 0, max: 1, step: 0.05, unit: "" },
      { key: "trailLift", label: "Distance from ground", min: 0, max: 0.15, step: 0.001, unit: "" },
      { key: "trailWidth", label: "Route width", min: 1, max: 6, step: 0.25, unit: "px" },
      { key: "routeMaxSpeed", label: "Max route speed", min: 0.1, max: 5, step: 0.1, unit: "u/s" },
      { key: "checkpointSpeed", label: "Checkpoint speed", min: 0.1, max: 3, step: 0.1, unit: "×" },
      { key: "checkpointDrift", label: "Wander distance", min: 0, max: 2, step: 0.05, unit: "" },
    ],
  },
  {
    title: "Landscape",
    controls: [
      { key: "extent", label: "Field size", min: 1, max: 3, step: 0.1, unit: "×" },
      { key: "elevation", label: "Mountain height", min: 0.15, max: 3, step: 0.05, unit: "×" },
      { key: "peaks", label: "Peak prominence", min: 0, max: 2, step: 0.05, unit: "" },
      { key: "spread", label: "Width", min: 0.6, max: 4, step: 0.05, unit: "×" },
      { key: "depth", label: "Depth", min: 0.6, max: 4, step: 0.05, unit: "×" },
    ],
  },
  {
    title: "Terrain motion",
    controls: [
      { key: "speed", label: "Terrain speed", min: 0, max: 1, step: 0.01, unit: "×" },
      { key: "evolution", label: "Landscape change", min: 0, max: 3, step: 0.1, unit: "×" },
      { key: "shimmer", label: "Shimmer", min: 0, max: 2, step: 0.05, unit: "" },
    ],
  },
  {
    title: "Terraces",
    controls: [
      { key: "contrast", label: "Line contrast", min: 0.1, max: 1, step: 0.05, unit: "" },
      { key: "stepHeight", label: "Step height", min: 0.04, max: 0.3, step: 0.01, unit: "" },
    ],
  },
  {
    title: "Placement",
    controls: [
      { key: "offsetX", label: "Horizontal position", min: -1, max: 1, step: 0.02, unit: "" },
      { key: "offsetY", label: "Vertical position", min: -1, max: 1, step: 0.02, unit: "" },
      { key: "fade", label: "Space for headline", min: 0, max: 1, step: 0.05, unit: "" },
    ],
  },
] satisfies {
  title: string;
  controls: {
    key: Exclude<
      keyof TerrainSettings,
      "scene" | "quality" | "terrainMotion" | "checkpointMotion" | "checkpointAvoidance"
    >;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[];
}[];

export function TerrainExplorer({
  settings,
  view,
  onChange,
  onViewChange,
}: {
  settings: TerrainSettings;
  view: "terrain" | "landing";
  onChange: (settings: TerrainSettings) => void;
  onViewChange: (view: "terrain" | "landing") => void;
}) {
  const sidebar = useLocalStorageSidebarState({
    defaults: sidebarDefaults,
    storageKey: "scout_terrain_sidebar_state",
  });
  const animationRef = useRef(createTerrainAnimation(settings));
  const [frameRevision, setFrameRevision] = useState(0);
  const experiment = settings.scene !== "landscape";
  const [diagnostics, setDiagnostics] = useState(false);
  const [diagnosticFrame, setDiagnosticFrame] = useState<TrailDiagnosticsFrame | null>(null);
  const diagnosticProps = omitNullish({
    onTrailDiagnostics: diagnostics || experiment ? setDiagnosticFrame : null,
  });
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<TerrainStatus | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const groups = controlGroups
    .map((group) => ({
      ...group,
      controls: group.controls.filter(
        (control) =>
          !experiment ||
          [
            "tilt",
            "rotation",
            "zoom",
            "peaks",
            "trailLift",
            "routeMaxSpeed",
            "checkpointSpeed",
            "speed",
          ].includes(control.key),
      ),
    }))
    .filter((group) => group.controls.length > 0)
    .sort((a, b) =>
      experiment
        ? ["Landscape", "Camera", "Route", "Terrain motion"].indexOf(a.title) -
          ["Landscape", "Camera", "Route", "Terrain motion"].indexOf(b.title)
        : 0,
    );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyMessage("Link copied");
    } catch (error) {
      setCopyMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function change(next: TerrainSettings) {
    if (next.scene !== settings.scene) animationRef.current = createTerrainAnimation(next);
    setCopyMessage("");
    onChange(next);
  }

  function resetScene(next: TerrainSettings) {
    animationRef.current = createTerrainAnimation(next);
    setPaused(false);
    change(next);
  }

  return (
    <SidebarRuntimeProvider controller={sidebar}>
      {diagnostics && diagnosticFrame && <TrailDiagnostics frame={diagnosticFrame} />}
      <main id="main-content" className="h-[calc(100dvh-4rem)] min-h-[28rem] bg-background">
        <SidebarLayout
          mobileMinResizeBehavior="min_resize_to_slide"
          resizeHandleLabels={{ left: "Resize terrain controls", right: "Resize preview" }}
          addressChrome={
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3 py-1.5">
              <div className="flex items-center gap-3">
                <TerrainControlsToggle />
                <h1 className="text-sm font-medium">Terrain explorer</h1>
              </div>
              <div className="flex items-center gap-1">
                <div
                  role="group"
                  aria-label="Preview mode"
                  className="mr-2 flex rounded-lg border p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={view === "terrain" || experiment}
                    onClick={() => onViewChange("terrain")}
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
                  >
                    Terrain
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === "landing" && !experiment}
                    disabled={experiment}
                    onClick={() => onViewChange("landing")}
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
                  >
                    Landing page
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPaused(!paused)}
                  aria-label={paused ? "Play animation" : "Pause animation"}
                  disabled={status?.kind === "unavailable"}
                >
                  {paused ? <PlayIcon /> : <PauseIcon />}
                  <span className="hidden sm:inline">{paused ? "Play" : "Pause"}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    resetScene(
                      experiment
                        ? { ...routeExperimentSettings, scene: settings.scene }
                        : defaultTerrainSettings,
                    )
                  }
                  aria-label="Reset terrain"
                >
                  <RotateCcwIcon />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Copy link"
                  onClick={() => void copyLink()}
                >
                  <LinkIcon />
                  <span className="hidden sm:inline">Copy link</span>
                </Button>
              </div>
            </div>
          }
          left={
            <PaneFrame
              scrollRestorationId="terrain-controls"
              content={
                <div className="p-5">
                  <div className="mb-6">
                    <h2 className="mb-3 text-xs font-medium text-muted-foreground">
                      Starting points
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {terrainPresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.name}
                          disabled={status?.kind === "unavailable"}
                          onClick={() =>
                            resetScene({ ...preset.settings, quality: settings.quality })
                          }
                          aria-pressed={
                            settings.scene === preset.settings.scene &&
                            controlGroups.every((group) =>
                              group.controls.every(
                                ({ key }) => settings[key] === preset.settings[key],
                              ),
                            )
                          }
                          className="rounded-lg border px-3 py-2 text-left text-xs hover:border-primary/40 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-primary disabled:opacity-40"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {experiment && (
                    <div className="mb-5 space-y-3">
                      <p className="text-sm leading-relaxed">
                        Drag either endpoint or change Peak prominence to recalculate the route
                        immediately. This also works while paused.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => change({ ...settings, tilt: 85, rotation: 0 })}
                        >
                          Top view
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => change({ ...settings, tilt: 55, rotation: 0 })}
                        >
                          Side view
                        </Button>
                      </div>
                    </div>
                  )}
                  {groups.map((group) => (
                    <fieldset
                      key={group.title}
                      disabled={status?.kind === "unavailable"}
                      className="mb-6 space-y-4 border-t pt-4 disabled:opacity-40"
                    >
                      <legend className="pr-3 text-xs font-medium text-muted-foreground">
                        {group.title}
                      </legend>
                      {group.title === "Route" && !experiment && (
                        <label className="flex items-center justify-between gap-2 text-xs">
                          Keep checkpoints visible
                          <input
                            type="checkbox"
                            role="switch"
                            checked={settings.checkpointAvoidance}
                            disabled={!settings.checkpointMotion}
                            onChange={(event) =>
                              change({
                                ...settings,
                                checkpointAvoidance: event.currentTarget.checked,
                              })
                            }
                            className="size-4 accent-primary"
                          />
                        </label>
                      )}
                      {(group.title === "Route" || group.title === "Terrain motion") && (
                        <label className="flex items-center justify-between gap-2 text-xs">
                          {group.title === "Route" ? "Animate checkpoints" : "Animate terrain"}
                          <input
                            type="checkbox"
                            role="switch"
                            checked={
                              group.title === "Route"
                                ? settings.checkpointMotion
                                : settings.terrainMotion
                            }
                            onChange={(event) =>
                              change({
                                ...settings,
                                [group.title === "Route" ? "checkpointMotion" : "terrainMotion"]:
                                  event.currentTarget.checked,
                              })
                            }
                            className="size-4 accent-primary"
                          />
                        </label>
                      )}
                      {group.title === "Route" && (
                        <div className="space-y-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={status?.kind !== "ready"}
                            onClick={() => {
                              animationRef.current.trail.replan = true;
                              setFrameRevision((revision) => revision + 1);
                            }}
                          >
                            Find route
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={status?.kind !== "ready"}
                            onClick={() => {
                              resetTrailConnection(animationRef.current.trail, settings);
                              setFrameRevision((revision) => revision + 1);
                            }}
                          >
                            <RotateCcwIcon /> Reset connection
                          </Button>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Dragging moves a checkpoint immediately and stretches the nearby line.
                            Max route speed controls how fast the line settles into its new route.
                            Height always follows the ground. Reset connection shows the direct
                            curve for comparison.
                          </p>
                        </div>
                      )}
                      {group.title === "Route" && (
                        <label className="flex items-center justify-between gap-2 text-xs">
                          Route diagnostics
                          <input
                            type="checkbox"
                            role="switch"
                            checked={diagnostics}
                            onChange={(event) => setDiagnostics(event.currentTarget.checked)}
                            className="size-4 accent-primary"
                          />
                        </label>
                      )}
                      {group.controls.map((control) => (
                        <label key={control.key} className="block text-xs">
                          <span className="mb-2 flex items-center justify-between gap-2">
                            {control.label}
                            <output className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {Number(settings[control.key].toFixed(control.step < 0.01 ? 3 : 2))}
                              {control.unit}
                            </output>
                          </span>
                          <input
                            type="range"
                            aria-label={control.label}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={settings[control.key]}
                            disabled={
                              (control.key === "checkpointSpeed" ||
                                control.key === "checkpointDrift") &&
                              !settings.checkpointMotion
                            }
                            onChange={(event) =>
                              change({
                                ...settings,
                                [control.key]: event.currentTarget.valueAsNumber,
                              })
                            }
                            className="block h-4 w-full cursor-pointer accent-primary"
                          />
                          {control.key === "peaks" && (
                            <span className="mt-1 block leading-relaxed text-muted-foreground">
                              Taller peaks make crossing them more costly, so a detour can be worth
                              the extra distance.
                            </span>
                          )}
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  <fieldset className="mb-6 space-y-3 border-t pt-4">
                    <legend className="pr-3 text-xs font-medium text-muted-foreground">
                      Rendering
                    </legend>
                    <label className="block text-xs">
                      <span className="mb-2 block">Quality</span>
                      <select
                        value={settings.quality}
                        onChange={(event) =>
                          change({
                            ...settings,
                            quality: terrainSettingsSchema.shape.quality.parse(
                              event.currentTarget.value,
                            ),
                          })
                        }
                        className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="auto">Automatic</option>
                        <option value="low">Balanced curves</option>
                        <option value="high">Fine curves</option>
                      </select>
                    </label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Both modes target 60 fps and wait when the GPU is busy. Automatic uses
                      balanced curves on phones and touch devices, and fine curves on desktop. Field
                      size adds more terrain; Width and Depth stretch it.
                    </p>
                  </fieldset>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Settings are saved in this URL. Copy the link to keep or compare a version.
                  </p>
                </div>
              }
            />
          }
          main={
            <div className="relative isolate h-full min-h-0 overflow-hidden bg-background">
              {experiment &&
                diagnosticFrame?.climb &&
                diagnosticFrame.snapshot.settings.scene === settings.scene && (
                  <div
                    aria-label="Climb comparison"
                    className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border bg-background/95 px-4 py-3 text-sm shadow-sm"
                  >
                    <p>
                      Route climb:{" "}
                      <span className="font-mono">{diagnosticFrame.climb.route.toFixed(2)}</span>
                    </p>
                    <p>
                      Direct climb:{" "}
                      <span className="font-mono">{diagnosticFrame.climb.direct.toFixed(2)}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Total uphill distance on the current terrain
                    </p>
                  </div>
                )}
              {view === "landing" && !experiment ? (
                <div className="h-full overflow-y-auto pb-20 [&_button:disabled]:opacity-50">
                  <DiscoveryHero
                    animationRef={animationRef}
                    frameRevision={frameRevision}
                    {...diagnosticProps}
                    settings={settings}
                    paused={paused}
                    onStatusChange={setStatus}
                    onCameraChange={(tilt, rotation) => change({ ...settings, tilt, rotation })}
                  >
                    <div inert>
                      <ConversationLobby kind="review" siteSelection={null} />
                    </div>
                  </DiscoveryHero>
                  <div inert className="relative mx-auto max-w-page px-8 pb-16 max-[640px]:px-4">
                    <Suspense fallback={<div className="min-h-60" aria-busy="true" />}>
                      <ActivityFeed search={{}} />
                    </Suspense>
                  </div>
                </div>
              ) : (
                <DiscoveryTerrain
                  animationRef={animationRef}
                  frameRevision={frameRevision}
                  {...diagnosticProps}
                  settings={settings}
                  paused={paused}
                  onStatusChange={setStatus}
                  onCameraChange={(tilt, rotation) => change({ ...settings, tilt, rotation })}
                />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-xs text-muted-foreground">
                <p className="max-w-sm rounded-lg bg-background/85 px-3 py-2">
                  {status?.kind === "unavailable"
                    ? `${status.message} Showing a static preview.`
                    : view === "terrain"
                      ? "Drag a checkpoint to move it. Drag the terrain to turn the camera."
                      : "Drag checkpoints to move them. Hide the controls to see the homepage at full width."}
                </p>
                <p role="status" className="rounded-lg bg-background/85 px-3 py-2 empty:hidden">
                  {copyMessage}
                </p>
              </div>
            </div>
          }
        />
      </main>
    </SidebarRuntimeProvider>
  );
}

function TerrainControlsToggle() {
  const { isMobile, mobilePane, leftDesktopOpen } = useSidebarLayoutPresentation();
  const { setMobilePane, toggleLeftPane } = useSidebarActions();
  const shown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={shown ? "Hide terrain controls" : "Show terrain controls"}
      aria-expanded={shown}
      onClick={() => (isMobile ? setMobilePane(shown ? "main" : "left") : toggleLeftPane())}
    >
      <SlidersHorizontalIcon />
      <span className="hidden sm:inline">Controls</span>
    </Button>
  );
}
