import { SidebarRuntimeProvider } from "@samebase/sidebars/SidebarRuntime";
import type { ReactNode } from "react";
import { useScoutSidebarController } from "./scoutSidebarState";

export function ScoutSidebarProvider({ children }: { children: ReactNode }) {
  const controller = useScoutSidebarController();

  return <SidebarRuntimeProvider controller={controller}>{children}</SidebarRuntimeProvider>;
}
