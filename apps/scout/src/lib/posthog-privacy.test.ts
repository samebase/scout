// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { CaptureResult } from "posthog-js";
import { record } from "posthog-js/rrweb";
import DOMTokenList from "happy-dom/lib/dom/DOMTokenList.js";
import { posthogConfig, updateAnalytics } from "./posthog";

afterEach(() => {
  updateAnalytics(null);
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("the actual SDK emits only the allowed page metadata and leaves no analytics storage", async () => {
  vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  updateAnalytics({ userId: "synthetic-account", recording: false, route: "/tasks/$thread" });
  const { PostHog } = await import("posthog-js");
  const client = new PostHog();
  client.init("synthetic-project", {
    ...posthogConfig,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    internal_or_test_user_hostname: null,
    opt_out_useragent_filter: true,
    request_batching: false,
    api_transport: "fetch",
    api_host: "https://posthog.example.test",
  });
  const emitted: CaptureResult[] = [];
  const unsubscribe = client.on("eventCaptured", (event: CaptureResult) => emitted.push(event));
  client.identify("synthetic-account");
  client.capture("$pageview", {
    $current_url: "https://example.test/tasks/SCOUT_TEST_SECRET?token=SCOUT_TEST_SECRET",
    $title: "SCOUT_TEST_SECRET",
    prompt: "SCOUT_TEST_SECRET",
  });
  expect(emitted.map((event) => event.event)).toContain("$pageview");
  expect(JSON.stringify(emitted)).not.toContain("SCOUT_TEST_SECRET");
  expect(emitted.at(-1)?.properties["$pathname"]).toBe("/tasks/$thread");
  expect(emitted.at(-1)?.properties["distinct_id"]).toBe("synthetic-account");
  expect(document.cookie).not.toContain("synthetic-project");
  expect(Object.keys(localStorage).some((key) => key.includes("synthetic-project"))).toBe(false);
  expect(Object.keys(sessionStorage).some((key) => key.includes("synthetic-project"))).toBe(false);
  unsubscribe();
  client.opt_out_capturing();
});

test("the bundled recorder masks rendered content, values, attributes, and embedded media", async () => {
  vi.stubGlobal("DOMTokenList", DOMTokenList);
  document.body.innerHTML = `
    <main data-private="SCOUT_TEST_SECRET">
      <p>SCOUT_TEST_SECRET visible text</p>
      <input value="SCOUT_TEST_SECRET">
      <input type="hidden" value="SCOUT_TEST_SECRET">
      <textarea>SCOUT_TEST_SECRET</textarea>
      <pre class="language-SCOUT_TEST_SECRET">SCOUT_TEST_SECRET</pre>
      <div style="background-image: url('https://example.test/SCOUT_TEST_SECRET')">private</div>
      <img src="https://example.test/SCOUT_TEST_SECRET" alt="SCOUT_TEST_SECRET">
      <iframe srcdoc="SCOUT_TEST_SECRET"></iframe>
      <div data-posthog-block><p>SCOUT_TEST_SECRET blocked transcript</p></div>
    </main>`;
  const snapshots: unknown[] = [];
  const stop = record({
    ...posthogConfig.session_recording,
    emit: (event) => snapshots.push(event),
  });
  try {
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    expect(JSON.stringify(snapshots)).not.toContain("SCOUT_TEST_SECRET");
    const paragraph = document.querySelector("p");
    if (!paragraph) throw new Error("Missing privacy fixture paragraph");
    const countBeforeChange = snapshots.length;
    paragraph.textContent = "SCOUT_TEST_SECRET changed text";
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(countBeforeChange));
    expect(JSON.stringify(snapshots)).not.toContain("SCOUT_TEST_SECRET");
  } finally {
    stop?.();
  }
});
