import { describe, expect, test } from "vite-plus/test";
import { browserTraceMarkers, parseBrowserTrace } from "./browserTelemetry";

function tabs() {
  return JSON.stringify({
    success: true,
    data: {
      tabs: [
        {
          tabId: "t1",
          title: "Checkout",
          url: "https://example.com/account?token=secret#verify",
          active: true,
        },
      ],
    },
  });
}

describe("browser telemetry", () => {
  test("parses a click trace and removes URL secrets", () => {
    const markers = browserTraceMarkers("fixed");
    const stdout = [
      markers.begin,
      "1000",
      tabs(),
      JSON.stringify({ success: true, data: { x: 10, y: 20, width: 80, height: 40 } }),
      "1010",
      "1020",
      tabs(),
      markers.end,
      '- button "Continue" [ref=e2]',
    ].join("\n");

    expect(parseBrowserTrace(stdout, "fixed", { kind: "click", ref: "@e1" })).toEqual({
      telemetry: {
        version: 1,
        before: {
          capturedAtMs: 1000,
          tabs: [
            {
              tabId: "t1",
              title: "Checkout",
              url: "https://example.com/account",
              active: true,
            },
          ],
        },
        dispatchedAtMs: 1010,
        returnedAtMs: 1020,
        after: {
          capturedAtMs: 1020,
          tabs: [
            {
              tabId: "t1",
              title: "Checkout",
              url: "https://example.com/account",
              active: true,
            },
          ],
        },
        pointer: {
          tabId: "t1",
          ref: "@e1",
          box: { x: 10, y: 20, width: 80, height: 40 },
        },
      },
      modelOutput: '- button "Continue" [ref=e2]',
    });
  });

  test("rejects a ref trace without exactly one active tab", () => {
    const markers = browserTraceMarkers("fixed");
    const emptyTabs = JSON.stringify({ success: true, data: { tabs: [] } });
    const stdout = [
      markers.begin,
      "1000",
      emptyTabs,
      JSON.stringify({ success: true, data: { x: 0, y: 0, width: 1, height: 1 } }),
      "1010",
      "1020",
      emptyTabs,
      markers.end,
      "snapshot",
    ].join("\n");

    expect(() => parseBrowserTrace(stdout, "fixed", { kind: "click", ref: "@e1" })).toThrow(
      "exactly one active tab",
    );
  });
});
