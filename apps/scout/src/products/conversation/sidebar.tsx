import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { useState, type ReactNode } from "react";
import { MonitorIcon, SquareIcon, XIcon } from "lucide-react";

export function ConversationSidebar({
  children,
  initialBrowserOpen,
}: {
  children: ReactNode;
  initialBrowserOpen: boolean;
}) {
  const [state, setState] = useState<SidebarLayoutState>({
    leftDesktopOpen: false,
    leftDesktopWidthPx: 0,
    leftMobileWidthPx: 0,
    mobilePane: "main",
    mobileSurface: { kind: "unmerged" },
    rightDesktopOpen: initialBrowserOpen,
    rightDesktopWidthPx: 560,
    rightMobileWidthPx: 768,
  });

  return (
    <SidebarRuntimeProvider controller={{ isHydrated: true, state, setState }}>
      <div className="play-session-layout flex min-h-0 flex-1 flex-col">{children}</div>
    </SidebarRuntimeProvider>
  );
}

export function BrowserToggle({
  action,
  view,
  replay,
}: {
  action: "open" | "close";
  view: "chat" | "walkthrough";
  replay: boolean;
}) {
  const { isMobile, mobilePane, rightDesktopOpen } = useSidebarLayoutPresentation();
  const { setMobilePane, toggleRightPane } = useSidebarActions();
  const shown = isMobile ? mobilePane === "right" : rightDesktopOpen;
  if (action === "open" && shown) return null;
  const label =
    action === "open"
      ? replay
        ? "Show replay"
        : "Show Scout’s view"
      : isMobile
        ? `Back to ${view}`
        : replay
          ? "Hide replay"
          : "Hide Scout’s view";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-2 hover:bg-secondary"
      onClick={() =>
        isMobile ? setMobilePane(action === "open" ? "right" : "main") : toggleRightPane()
      }
    >
      {action === "open" ? (
        <MonitorIcon size={19} aria-hidden="true" />
      ) : (
        <XIcon size={18} aria-hidden="true" />
      )}
      {replay && action === "open" && <span className="text-xs">Replay</span>}
    </button>
  );
}

export function BrowserStop({ onStop, disabled }: { onStop: () => void; disabled: boolean }) {
  const { isMobile, mobilePane } = useSidebarLayoutPresentation();
  if (!isMobile || mobilePane !== "right") return null;

  return (
    <button
      type="button"
      aria-label="Stop Scout"
      onClick={onStop}
      disabled={disabled}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-foreground hover:text-primary"
    >
      <SquareIcon size={14} aria-hidden="true" /> Stop
    </button>
  );
}
