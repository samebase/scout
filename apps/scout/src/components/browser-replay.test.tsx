// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { api } from "../../convex/_generated/api";
import { BrowserReplay } from "./browser-replay";

type Pages = FunctionReturnType<typeof api.browserReplay.listPages>;
const remote = vi.hoisted(() => ({
  pages: vi.fn<() => Promise<Pages>>(),
  playlist: vi.fn<() => Promise<FunctionReturnType<typeof api.browserReplay.loadPlaylist>>>(),
}));
vi.mock("convex/react", () => ({
  useAction: (reference: FunctionReference<"action">) =>
    getFunctionName(reference) === "browserReplay:listPages" ? remote.pages : remote.playlist,
}));
vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "error" };
    static isSupported() {
      return true;
    }
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

// @ts-expect-error The mocked Convex transport uses a stable string instead of a database-generated ID.
const sessionId: FunctionArgs<typeof api.browserReplay.listPages>["sessionId"] = "recording-1";
const desktop: Pages = {
  status: "ready",
  pages: [{ pageId: "0", pageUrl: "", startTimeMs: 0, endTimeMs: 8083 }],
  viewport: { width: 1280, height: 800 },
  operations: [
    {
      sequence: 1,
      clickCapture: null,
      state: {
        kind: "applied",
        settledAtMs: 12000,
        telemetry: {
          version: 1,
          returnedAtMs: 11000,
          before: {
            capturedAtMs: 10000,
            tabs: [{ tabId: "t1", url: "https://example.com/", title: "Example", active: true }],
          },
          dispatchedAtMs: 10500,
          after: {
            capturedAtMs: 11000,
            tabs: [{ tabId: "t1", url: "https://example.com/", title: "Example", active: true }],
          },
        },
      },
    },
  ],
};

beforeEach(() => {
  remote.pages.mockReset().mockResolvedValue(desktop);
  remote.playlist
    .mockReset()
    .mockResolvedValue({ status: "ready", playlist: "#EXTM3U\n#EXT-X-ENDLIST" });
});
afterEach(cleanup);

async function mountReplay(selectedPageId: string | null = null) {
  await act(async () => {
    render(
      <BrowserReplay
        sessionId={sessionId}
        mode="inspector"
        selectedPageId={selectedPageId}
        onSelectPage={() => {}}
      />,
    );
  });
}

test.each([null, "previous-tab"])(
  "selects desktop video even with a stale selection %s and omits tab controls and click overlays",
  async (selectedPageId) => {
    await mountReplay(selectedPageId);
    expect(
      screen.getByLabelText("Recorded Scout browser session").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: /Follow.*Scout/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Recorded URL" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Show clicks/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Export MP4" })).toBeTruthy();
  },
);

test("shows the actual metadata and playlist errors and supports manual retry", async () => {
  remote.pages.mockResolvedValueOnce({
    status: "failed",
    message: "Firecrawl GET /v2/browser/session/replay: HTTP 404. Replay not found.",
  });
  await mountReplay();
  expect(screen.getByRole("alert").textContent).toContain("HTTP 404. Replay not found.");
  expect(screen.queryByText(/processing|Preparing replay/)).toBeNull();
  remote.playlist.mockResolvedValueOnce({
    status: "failed",
    message: "Firecrawl GET /v2/browser/session/replay/0: HTTP 502. Recording read failed.",
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
  expect(screen.getByRole("alert").textContent).toContain("HTTP 502. Recording read failed.");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })));
  expect(screen.getByLabelText("Recorded Scout browser session").getAttribute("aria-hidden")).toBe(
    "false",
  );
});
