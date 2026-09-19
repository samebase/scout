// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: sdk }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-token");
});
afterEach(() => vi.unstubAllEnvs());

test("a revoked grant cannot start recording when the SDK finishes loading", async () => {
  const analytics = await import("./posthog");
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/" });
  analytics.stopRecordingImmediately();
  analytics.updateAnalytics({ userId: "alice", recording: false, route: "/" });
  await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledOnce());
  expect(sdk.startSessionRecording).not.toHaveBeenCalled();
  expect(sdk.identify).toHaveBeenCalledExactlyOnceWith("alice");
});

test("navigation keeps identity; logout and a different account stop the previous recording", async () => {
  const analytics = await import("./posthog");
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/" });
  await vi.waitFor(() => expect(sdk.startSessionRecording).toHaveBeenCalled());
  sdk.reset.mockClear();
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/tasks/$thread" });
  expect(sdk.reset).not.toHaveBeenCalled();
  expect(sdk.identify).toHaveBeenCalledOnce();
  analytics.resetAnalytics();
  expect(sdk.reset).toHaveBeenCalledOnce();
  sdk.startSessionRecording.mockClear();
  analytics.updateAnalytics({ userId: "bob", recording: false, route: "/" });
  expect(sdk.startSessionRecording).not.toHaveBeenCalled();
  expect(sdk.identify).toHaveBeenLastCalledWith("bob");
});

test("withdrawing stops immediately even before the saved query updates", async () => {
  const analytics = await import("./posthog");
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/" });
  await vi.waitFor(() => expect(sdk.startSessionRecording).toHaveBeenCalled());
  analytics.stopRecordingImmediately();
  sdk.startSessionRecording.mockClear();
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/tasks/$thread" });
  expect(sdk.startSessionRecording).not.toHaveBeenCalled();
  analytics.resumeRecordingAfterConsent();
  expect(sdk.startSessionRecording).toHaveBeenCalledOnce();
});

test("events contain route templates without titles, URLs, person properties, or custom payloads", async () => {
  const analytics = await import("./posthog");
  analytics.updateAnalytics({ userId: "alice", recording: false, route: "/tasks/$thread" });
  const event = analytics.posthogConfig.before_send({
    event: "$pageview",
    uuid: "test-event",
    timestamp: new Date(),
    properties: {
      distinct_id: "alice",
      $current_url: "https://scout.test/tasks/secret?token=secret#secret",
      $initial_current_url: "secret",
      $pathname: "secret",
      $title: "secret",
      $session_entry_referrer: "secret",
      $set: { email: "secret" },
      userPrompt: "secret",
      $browser: "Chrome",
    },
    $set: { email: "secret" },
    $set_once: { $initial_referrer: "secret" },
  });
  expect(event?.properties["$pathname"]).toBe("/tasks/$thread");
  expect(event?.properties["$browser"]).toBe("Chrome");
  expect(event?.properties["distinct_id"]).toBe("alice");
  expect(JSON.stringify(event)).not.toContain("secret");
  expect(
    analytics.posthogConfig.before_send({
      uuid: "exception",
      event: "$exception",
      properties: { message: "secret" },
    }),
  ).toBeNull();
});

test("handoff events and recordings without consent are dropped before transmission", async () => {
  const analytics = await import("./posthog");
  analytics.updateAnalytics({ userId: "alice", recording: false, route: "/" });
  expect(
    analytics.posthogConfig.before_send({ uuid: "snapshot", event: "$snapshot", properties: {} }),
  ).toBeNull();
  analytics.updateAnalytics({ userId: "alice", recording: true, route: "/handoff/$sessionId" });
  expect(
    analytics.posthogConfig.before_send({ uuid: "snapshot", event: "$snapshot", properties: {} }),
  ).toBeNull();
  expect(
    analytics.posthogConfig.before_send({ uuid: "pageview", event: "$pageview", properties: {} }),
  ).toBeNull();
});
