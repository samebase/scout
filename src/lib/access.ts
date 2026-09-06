import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { AccessKey } from "../../shared/accessModel";
import type { ViewerAccess } from "../../convex/access";
export { canAccess } from "../../shared/accessModel";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    access: AccessKey;
  }
}

export function useViewerAccess() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.accounts.currentViewerAccess, isAuthenticated ? {} : "skip");
  if (isLoading) return undefined;
  return isAuthenticated ? viewer : { kind: "anonymous" as const };
}

export function accountAccessMessage(viewer: ViewerAccess | undefined) {
  if (viewer?.kind === "unavailable")
    return {
      title: "Access unavailable",
      description: "This account’s access could not be loaded.",
    };
  if (viewer?.kind !== "account") return null;
  if (viewer.status === "suspended")
    return {
      title: "Account suspended",
      description: "An admin has suspended access to this account.",
    };
  if (!viewer.isApproved)
    return {
      title: "Waiting for approval",
      description:
        "Your account is ready. An admin needs to approve access. This page will update automatically.",
    };
  return null;
}
