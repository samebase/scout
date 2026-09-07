import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { useState, type ReactNode } from "react";
import { MonitorIcon, SquareIcon, XIcon } from "lucide-react";

export function PlaySidebar({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarLayoutState>({
    leftDesktopOpen: false,
    leftDesktopWidthPx: 0,
    leftMobileWidthPx: 0,
    mobilePane: "main",
    mobileSurface: { kind: "unmerged" },
    rightDesktopOpen: true,
    rightDesktopWidthPx: 560,
    rightMobileWidthPx: 768,
  });

  return (
    <SidebarRuntimeProvider controller={{ isHydrated: true, state, setState }}>
      <div className="play-session-layout flex min-h-0 flex-1 flex-col">{children}</div>
    </SidebarRuntimeProvider>
  );
}

export function PlayBrowserToggle({ action }: { action: "open" | "close" }) {
  const { isMobile, mobilePane, rightDesktopOpen } = useSidebarLayoutPresentation();
  const { setMobilePane, toggleRightPane } = useSidebarActions();
  const shown = isMobile ? mobilePane === "right" : rightDesktopOpen;
  if (action === "open" && shown) return null;
  const label =
    action === "open" ? "Show Scout’s view" : isMobile ? "Back to chat" : "Hide Scout’s view";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-play-cloud"
      onClick={() =>
        isMobile ? setMobilePane(action === "open" ? "right" : "main") : toggleRightPane()
      }
    >
      {action === "open" ? (
        <MonitorIcon size={19} aria-hidden="true" />
      ) : (
        <XIcon size={18} aria-hidden="true" />
      )}
    </button>
  );
}

export function PlayBrowserStop({ onStop, disabled }: { onStop: () => void; disabled: boolean }) {
  const { isMobile, mobilePane } = useSidebarLayoutPresentation();
  if (!isMobile || mobilePane !== "right") return null;

  return (
    <button
      type="button"
      aria-label="Stop Scout"
      onClick={onStop}
      disabled={disabled}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-play-ink hover:text-play-blue"
    >
      <SquareIcon size={14} aria-hidden="true" /> Stop
    </button>
  );
}
