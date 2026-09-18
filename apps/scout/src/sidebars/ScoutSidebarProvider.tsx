import { SidebarRuntimeProvider } from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutStateController } from "@samebase/sidebars/SidebarLayoutState";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import { useScoutSidebarController } from "./scoutSidebarState";

export function ScoutSidebarProvider({ children }: { children: ReactNode }) {
  const controller = useScoutSidebarController();
  const agentsSearch = useSearch({ from: "/agents", shouldThrow: false });
  const navigate = useNavigate();
  const state = agentsSearch
    ? {
        ...controller.state,
        leftDesktopOpen: agentsSearch.sessions !== "hidden",
        rightDesktopOpen: agentsSearch.inspector !== "hidden",
        mobilePane: agentsSearch.pane ?? "main",
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
        agentsSearch &&
        (next.leftDesktopOpen !== current.leftDesktopOpen ||
          next.rightDesktopOpen !== current.rightDesktopOpen ||
          next.mobilePane !== current.mobilePane)
      ) {
        void navigate({
          from: "/agents",
          to: "/agents",
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
