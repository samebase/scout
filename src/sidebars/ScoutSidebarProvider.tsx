import { SidebarRuntimeProvider } from "@samebase/sidebars/SidebarRuntime";
import type { SidebarLayoutStateController } from "@samebase/sidebars/SidebarLayoutState";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import { useScoutSidebarController } from "./scoutSidebarState";
import { defaultChatPane } from "#lib/chat-search";

export function ScoutSidebarProvider({ children }: { children: ReactNode }) {
  const controller = useScoutSidebarController();
  const search = useSearch({ from: "/chats", shouldThrow: false });
  const navigate = useNavigate({ from: "/chats" });
  const state = search
    ? {
        ...controller.state,
        leftDesktopOpen: search.chats !== "hidden",
        rightDesktopOpen: search.inspector !== "hidden",
        mobilePane: search.pane ?? defaultChatPane(search),
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
        search &&
        (next.leftDesktopOpen !== current.leftDesktopOpen ||
          next.rightDesktopOpen !== current.rightDesktopOpen ||
          next.mobilePane !== current.mobilePane)
      ) {
        void navigate({
          to: "/chats",
          search: (previous) => ({
            ...previous,
            chats: next.leftDesktopOpen ? undefined : "hidden",
            inspector: next.rightDesktopOpen ? undefined : "hidden",
            pane: next.mobilePane === defaultChatPane(previous) ? undefined : next.mobilePane,
          }),
          replace: persistenceMode === "width_deferred",
        });
      }
    },
  };

  return <SidebarRuntimeProvider controller={routeController}>{children}</SidebarRuntimeProvider>;
}
