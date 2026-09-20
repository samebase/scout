import { SidebarRuntimeProvider } from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutStateController } from "@samebase/sidebars/SidebarLayoutState";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import { useScoutSidebarController } from "./scoutSidebarState";

export function ScoutSidebarProvider({ children }: { children: ReactNode }) {
  const controller = useScoutSidebarController();
  const labSearch = useSearch({ from: "/lab", shouldThrow: false });
  const navigate = useNavigate();
  const state = labSearch
    ? {
        ...controller.state,
        leftDesktopOpen: labSearch.sessions !== "hidden",
        rightDesktopOpen: labSearch.inspector !== "hidden",
        mobilePane: labSearch.pane ?? "main",
      }
    : controller.state;
  const latestState = useRef(state);
  latestState.current = state;
  const routeController: SidebarLayoutStateController = {
    ...controller,
    state,
    setState(update, persistenceMode) {
      const current = latestState.current;
      const next = update(current);
      latestState.current = next;
      controller.setState(() => next, persistenceMode);
      if (
        labSearch &&
        (next.leftDesktopOpen !== current.leftDesktopOpen ||
          next.rightDesktopOpen !== current.rightDesktopOpen ||
          next.mobilePane !== current.mobilePane)
      ) {
        void navigate({
          from: "/lab",
          to: "/lab",
          search: (previous) => ({
            ...previous,
            sessions: next.leftDesktopOpen ? undefined : "hidden",
            inspector: next.rightDesktopOpen ? undefined : "hidden",
            pane: next.mobilePane === "main" ? undefined : next.mobilePane,
          }),
          replace: persistenceMode === "width_deferred",
          resetScroll: false,
        });
      }
    },
  };

  return <SidebarRuntimeProvider controller={routeController}>{children}</SidebarRuntimeProvider>;
}
