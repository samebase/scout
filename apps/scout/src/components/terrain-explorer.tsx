import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import { LinkIcon, PauseIcon, PlayIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";
import {
  atlasTerrainSettings,
  terrainPresets,
  terrainSettingsSchema,
  type TerrainSettings,
} from "#lib/terrain-settings";
import { DiscoveryTerrain, type TerrainStatus } from "./discovery-terrain";
import { DiscoveryHero } from "./discovery-hero";
import { ActivityFeed } from "./activity-feed";
import { ConversationLobby } from "../products/conversation/page";
import { Button } from "./ui/button";

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
    title: "Motion",
    controls: [
      { key: "speed", label: "Animation speed", min: 0, max: 8, step: 0.1, unit: "×" },
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
    key: Exclude<keyof TerrainSettings, "quality">;
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
  const [sidebar, setSidebar] = useState<SidebarLayoutState>({
    leftDesktopOpen: true,
    leftDesktopWidthPx: 288,
    leftMobileWidthPx: 288,
    mobilePane: "main",
    mobileSurface: { kind: "unmerged" },
    rightDesktopOpen: false,
    rightDesktopWidthPx: 0,
    rightMobileWidthPx: 0,
  });
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<TerrainStatus | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyMessage("Link copied");
    } catch (error) {
      setCopyMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function change(next: TerrainSettings) {
    setCopyMessage("");
    onChange(next);
  }

  return (
    <SidebarRuntimeProvider controller={{ isHydrated: true, state: sidebar, setState: setSidebar }}>
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
                    aria-pressed={view === "terrain"}
                    onClick={() => onViewChange("terrain")}
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
                  >
                    Terrain
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === "landing"}
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
                  onClick={() => change(atlasTerrainSettings)}
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
                          onClick={() => change({ ...preset.settings, quality: settings.quality })}
                          aria-pressed={controlGroups.every((group) =>
                            group.controls.every(
                              ({ key }) => settings[key] === preset.settings[key],
                            ),
                          )}
                          className="rounded-lg border px-3 py-2 text-left text-xs hover:border-primary/40 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-primary disabled:opacity-40"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {controlGroups.map((group) => (
                    <fieldset
                      key={group.title}
                      disabled={status?.kind === "unavailable"}
                      className="mb-6 space-y-4 border-t pt-4 disabled:opacity-40"
                    >
                      <legend className="pr-3 text-xs font-medium text-muted-foreground">
                        {group.title}
                      </legend>
                      {group.controls.map((control) => (
                        <label key={control.key} className="block text-xs">
                          <span className="mb-2 flex items-center justify-between gap-2">
                            {control.label}
                            <output className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {Number(settings[control.key].toFixed(2))}
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
                            onChange={(event) =>
                              change({
                                ...settings,
                                [control.key]: event.currentTarget.valueAsNumber,
                              })
                            }
                            className="block h-4 w-full cursor-pointer accent-primary"
                          />
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
                      Both modes are capped at 24 fps. Automatic uses balanced curves on phones and
                      touch devices, and fine curves on desktop. Field size adds more terrain; Width
                      and Depth stretch it.
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
              {view === "landing" ? (
                <div className="h-full overflow-y-auto pb-20 [&_button:disabled]:opacity-50">
                  <DiscoveryHero
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
                    <ActivityFeed search={{}} initialFeed={null} />
                  </div>
                </div>
              ) : (
                <DiscoveryTerrain
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
                      ? "Drag the landscape to turn the camera. Use the sidebar to adjust the terrain."
                      : "Homepage at this preview width. Hide the controls to see it at full width."}
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
