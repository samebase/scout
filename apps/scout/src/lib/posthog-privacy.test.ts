// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { CaptureResult } from "posthog-js";
import { record } from "posthog-js/rrweb";
import DOMTokenList from "happy-dom/lib/dom/DOMTokenList.js";
import HappyDOMNode from "happy-dom/lib/nodes/node/Node.js";
import CharacterData from "happy-dom/lib/nodes/character-data/CharacterData.js";
import { posthogConfig, updateAnalytics } from "./posthog";

afterEach(() => {
  updateAnalytics(null);
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

test("the bundled recorder keeps the page readable and masks only credentials and marked areas", async () => {
  vi.stubGlobal("DOMTokenList", DOMTokenList);
  // rrweb calls Node's native getter directly; Happy DOM only implements it on CharacterData.
  vi.spyOn(HappyDOMNode.prototype, "textContent", "get").mockImplementation(
    function (this: HappyDOMNode) {
      return this instanceof CharacterData ? this.data : "";
    },
  );
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(".replay-layout { display: grid; }");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/style-public.css";
  Object.defineProperty(link, "sheet", { value: stylesheet });
  document.head.append(link);
  document.body.innerHTML = `
    <main class="replay-layout" data-state="open">
      <p>Readable public page text</p>
      <input value="Visible search query">
      <textarea>Visible task prompt</textarea>
      <input type="password" value="SCOUT_TEST_SECRET">
      <input type="hidden" value="SCOUT_TEST_SECRET">
      <input autocomplete="one-time-code" value="SCOUT_TEST_SECRET">
      <span data-posthog-mask>SCOUT_TEST_SECRET</span>
      <pre><code>Readable public code</code></pre>
      <div style="background-color: red">Styled content</div>
      <img src="https://example.test/public-image.png" alt="Public site preview">
      <svg viewBox="0 0 24 24"><path d="M1 1 L2 2" /></svg>
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
    for (const visible of [
      ".replay-layout { display: grid; }",
      "Readable public page text",
      "Visible search query",
      "Visible task prompt",
      "Readable public code",
      "background-color: red",
      "public-image.png",
      "M1 1 L2 2",
    ]) {
      expect(JSON.stringify(snapshots)).toContain(visible);
    }
    expect(JSON.stringify(snapshots)).not.toContain("SCOUT_TEST_SECRET");
    const paragraph = document.querySelector("p");
    if (!paragraph) throw new Error("Missing privacy fixture paragraph");
    const countBeforeChange = snapshots.length;
    paragraph.textContent = "Readable changed text";
    const password = document.querySelector('input[type="password"]');
    if (!(password instanceof HTMLInputElement)) throw new Error("Missing password fixture");
    password.value = "SCOUT_TEST_SECRET changed password";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(countBeforeChange));
    await vi.waitFor(() =>
      expect(JSON.stringify(snapshots)).toContain('"text":"' + "*".repeat(password.value.length)),
    );
    expect(JSON.stringify(snapshots)).toContain("Readable changed text");
    expect(JSON.stringify(snapshots)).not.toContain("SCOUT_TEST_SECRET");
  } finally {
    stop?.();
  }
});
