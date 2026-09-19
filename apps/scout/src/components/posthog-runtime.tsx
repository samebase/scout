import { useMatches } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { SESSION_RECORDING_CONSENT_VERSION } from "../../shared/sessionRecording";
import { updateAnalytics } from "../lib/posthog";

export function PostHogRuntime() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const preferences = useQuery(api.accounts.analyticsPreferences, isAuthenticated ? {} : "skip");
  const route = useMatches({ select: (matches) => matches.at(-1)?.routeId ?? "/" });
  const userId = preferences?.userId ?? null;
  const recording =
    preferences?.recording?.enabled === true &&
    preferences.recording.version === SESSION_RECORDING_CONSENT_VERSION;
  const unresolved = isLoading || (isAuthenticated && preferences === undefined);

  useEffect(() => {
    updateAnalytics(unresolved ? null : { userId, recording, route });
  }, [unresolved, userId, recording, route]);
  useEffect(() => () => updateAnalytics(null), []);
  return null;
}
