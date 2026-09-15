import {
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutState } from "@samebase/sidebars/SidebarLayoutState";
import { SidebarLayout, type SidebarLayoutProps } from "@samebase/sidebars/SidebarLayout";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { MonitorIcon, SquareIcon, XIcon } from "lucide-react";
import type { ProductKind } from "./model";
import { omitNullish } from "../../../shared/omitNullish";

export function ConversationSidebar({ children }: { children: ReactNode }) {
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

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function ConversationLayout({
  kind,
  addressChrome,
  main,
  right,
}: Pick<SidebarLayoutProps, "addressChrome" | "main"> & {
  kind: ProductKind;
  right: SidebarLayoutProps["right"];
}) {
  const isMobile = useSyncExternalStore(
    subscribeViewport,
    () => window.innerWidth < 768,
    () => false,
  );
  if (kind === "review" && isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="shrink-0">{addressChrome}</div>
        <div className="min-h-96 shrink-0 basis-[65dvh] grow">{main}</div>
        {right && <div className="mt-3 h-[60dvh] min-h-96 shrink-0">{right}</div>}
      </div>
    );
  }

  return (
    <SidebarLayout
      addressChrome={addressChrome}
      main={main}
      {...omitNullish({ right })}
      mobileMinResizeBehavior="min_resize_to_slide"
      resizeHandleLabels={{ left: "Resize chat navigation", right: "Resize Scout’s view" }}
    />
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
