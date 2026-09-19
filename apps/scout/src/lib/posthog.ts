import type { BeforeSendFn, PostHog, PostHogConfig } from "posthog-js";

export type AnalyticsState = {
  userId: string | null;
  recording: boolean;
  route: string;
};

let client: PostHog | undefined;
let loading: Promise<void> | undefined;
let current: AnalyticsState | null = null;
let identifiedUser: string | null = null;
let suspendedUser: string | null = null;
let lastPageview: string | null = null;

const replayBlockSelector =
  "[data-posthog-block], .ph-no-capture, iframe, img, picture, video, audio, canvas, svg, pre, code, [contenteditable], input[type=hidden], input[type=file]";

const eventProperties = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$anon_distinct_id",
  "$user_id",
  "$is_identified",
  "$process_person_profile",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$snapshot_data",
  "$snapshot_bytes",
  "$snapshot_source",
]);

const beforeSend: BeforeSendFn = (event) => {
  if (!event || !current || current.route.startsWith("/handoff/")) return null;
  if (event.event === "$snapshot" && !canRecord()) return null;
  if (!["$pageview", "$identify", "$snapshot"].includes(event.event)) return null;
  event.properties = Object.fromEntries(
    Object.entries(event.properties).filter(([key]) => eventProperties.has(key)),
  );
  event.properties["$current_url"] = window.location.origin + current.route;
  event.properties["$pathname"] = current.route;
  event.properties["environment"] = import.meta.env.DEV ? "development" : "production";
  delete event.$set;
  delete event.$set_once;
  return event;
};

export const posthogConfig = {
  api_host: "https://eu.i.posthog.com",
  ui_host: "https://eu.posthog.com",
  defaults: "2026-01-30",
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_exceptions: false,
  capture_performance: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  rageclick: false,
  disable_surveys: true,
  advanced_disable_feature_flags: true,
  disable_persistence: true,
  reuseAnonymousId: true,
  disable_session_recording: true,
  enable_recording_console_log: false,
  disable_capture_url_hashes: true,
  respect_dnt: true,
  ip: false,
  before_send: beforeSend,
  session_recording: {
    blockSelector: replayBlockSelector,
    maskAllInputs: true,
    maskTextSelector: "*",
    maskAttributeFn: (name, value, element) =>
      name === "class" && element && !element.matches(replayBlockSelector) ? value : "[masked]",
    captureJsonLd: false,
    collectFonts: false,
    inlineStylesheet: true,
    recordCrossOriginIframes: false,
    recordHeaders: false,
    recordBody: false,
    captureCanvas: { recordCanvas: false },
    maskCapturedNetworkRequestFn: (request) =>
      current
        ? {
            ...request,
            name: window.location.origin + current.route,
            url: window.location.origin + current.route,
          }
        : null,
  },
} satisfies Partial<PostHogConfig>;

function canRecord() {
  return Boolean(
    current?.userId &&
    current.recording &&
    current.userId !== suspendedUser &&
    ![
      "/handoff/",
      "/members",
      "/scouts",
      "/agents",
      "/settings",
      "/credit-history",
      "/account-deletion",
    ].some((path) => current?.route.startsWith(path)),
  );
}

function synchronize() {
  if (!client) return;
  const userId = current?.userId ?? null;
  if (identifiedUser !== userId) {
    client.stopSessionRecording();
    client.reset();
    identifiedUser = userId;
    lastPageview = null;
    if (userId) client.identify(userId);
  }
  if (canRecord()) client.startSessionRecording();
  else client.stopSessionRecording();
  if (!current) return;
  const pageview = `${userId ?? "anonymous"}:${current.route}`;
  if (pageview !== lastPageview) {
    client.capture("$pageview");
    lastPageview = pageview;
  }
}

export function updateAnalytics(state: AnalyticsState | null) {
  current = state;
  if (client) {
    synchronize();
    return;
  }
  const token = import.meta.env["VITE_PUBLIC_POSTHOG_PROJECT_TOKEN"];
  if (!state || !token || loading || typeof window === "undefined") return;
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      client = posthog;
      posthog.init(token, posthogConfig);
      synchronize();
    })
    .catch((error: unknown) => {
      console.error("PostHog initialization failed", error);
    });
}

export function stopRecordingImmediately() {
  suspendedUser = current?.userId ?? null;
  client?.stopSessionRecording();
}

export function resumeRecordingAfterConsent() {
  suspendedUser = null;
  synchronize();
}

export function resetAnalytics() {
  stopRecordingImmediately();
  updateAnalytics(null);
}
