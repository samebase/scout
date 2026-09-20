import { SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX } from "@samebase/sidebars/SidebarLayoutGeometry";
import type {
  SidebarLayoutState,
  SidebarLayoutStateController,
  SidebarLayoutStatePersistenceMode,
  SidebarLayoutStateUpdate,
} from "@samebase/sidebars/SidebarLayoutState";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

const SIDEBAR_STORAGE_VERSION = 2;
const SIDEBAR_WIDTH_PERSIST_DELAY_MS = 160;
const storedSidebarStateSchema = z.object({
  version: z.literal(SIDEBAR_STORAGE_VERSION),
  state: z.object({
    leftDesktopOpen: z.boolean(),
    leftDesktopWidthPx: z.number(),
    leftMobileWidthPx: z.number(),
    mobilePane: z.enum(["left", "main", "right"]),
    mobileSurface: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unmerged") }),
      z.object({
        kind: z.literal("merged"),
        mainWidthPx: z.number().min(SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX),
        side: z.enum(["left", "right"]),
      }),
    ]),
    rightDesktopOpen: z.boolean(),
    rightDesktopWidthPx: z.number(),
    rightMobileWidthPx: z.number(),
  }),
});

function writeSidebarState(storageKey: string, state: SidebarLayoutState) {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ state, version: SIDEBAR_STORAGE_VERSION }),
    );
  } catch (error) {
    console.warn("Failed to save sidebar state:", error);
  }
}

export function useLocalStorageSidebarState({
  defaults,
  storageKey,
}: {
  defaults: SidebarLayoutState;
  storageKey: string;
}): SidebarLayoutStateController {
  const [sidebarState, setSidebarState] = useState(defaults);
  const latestSidebarStateRef = useRef(sidebarState);
  const pendingWidthPersistRef = useRef<{
    state: SidebarLayoutState;
    storageKey: string;
  } | null>(null);
  const pendingWidthPersistTimeoutRef = useRef<number | null>(null);

  const flushPendingWidthPersist = useCallback(() => {
    if (pendingWidthPersistTimeoutRef.current !== null) {
      window.clearTimeout(pendingWidthPersistTimeoutRef.current);
      pendingWidthPersistTimeoutRef.current = null;
    }
    const pending = pendingWidthPersistRef.current;
    pendingWidthPersistRef.current = null;
    if (pending !== null) {
      writeSidebarState(pending.storageKey, pending.state);
    }
  }, []);

  const applySidebarState = useCallback(
    (updateState: SidebarLayoutStateUpdate, persistenceMode: SidebarLayoutStatePersistenceMode) => {
      const currentState = latestSidebarStateRef.current;
      const nextState = updateState(currentState);
      if (nextState === currentState) return;

      latestSidebarStateRef.current = nextState;
      setSidebarState(nextState);
      pendingWidthPersistRef.current = { state: nextState, storageKey };
      if (persistenceMode === "immediate") {
        flushPendingWidthPersist();
      } else {
        if (pendingWidthPersistTimeoutRef.current !== null) {
          window.clearTimeout(pendingWidthPersistTimeoutRef.current);
        }
        pendingWidthPersistTimeoutRef.current = window.setTimeout(
          flushPendingWidthPersist,
          SIDEBAR_WIDTH_PERSIST_DELAY_MS,
        );
      }
    },
    [flushPendingWidthPersist, storageKey],
  );

  useLayoutEffect(() => {
    let state = defaults;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) {
        const parsed = storedSidebarStateSchema.safeParse(JSON.parse(stored));
        if (parsed.success) state = parsed.data.state;
      }
    } catch (error) {
      console.warn("Failed to read sidebar state:", error);
    }
    latestSidebarStateRef.current = state;
    setSidebarState(state);
    return flushPendingWidthPersist;
  }, [defaults, flushPendingWidthPersist, storageKey]);

  useEffect(() => {
    window.addEventListener("pagehide", flushPendingWidthPersist);
    return () => window.removeEventListener("pagehide", flushPendingWidthPersist);
  }, [flushPendingWidthPersist]);

  return useMemo(
    () => ({ isHydrated: true, state: sidebarState, setState: applySidebarState }),
    [applySidebarState, sidebarState],
  );
}
