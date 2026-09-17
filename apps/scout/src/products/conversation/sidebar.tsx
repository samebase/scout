import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { useState, type ReactNode } from "react";
import { MonitorIcon, PanelLeftIcon, SquareIcon, XIcon } from "lucide-react";

export function ConversationSidebar({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarLayoutState>({
    leftDesktopOpen: true,
    leftDesktopWidthPx: 260,
    leftMobileWidthPx: 300,
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

export function TasksToggle() {
  const { isMobile, mobilePane, leftDesktopOpen } = useSidebarLayoutPresentation();
  const { setMobilePane, toggleLeftPane } = useSidebarActions();
  const shown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const label = shown ? (isMobile ? "Back to task" : "Hide tasks") : "Show tasks";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={shown}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-secondary"
      onClick={() => (isMobile ? setMobilePane(shown ? "main" : "left") : toggleLeftPane())}
    >
      <PanelLeftIcon size={18} aria-hidden="true" />
    </button>
  );
}

export function BrowserToggle({ action }: { action: "open" | "close" }) {
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
