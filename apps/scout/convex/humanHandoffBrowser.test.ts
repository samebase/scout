import { describe, expect, it, vi } from "vite-plus/test";
import { finishHandedOffBrowser } from "./humanHandoffBrowser";

const SESSION = {
  providerSessionId: "session-1",
  cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
};

function stoppedBrowser() {
  return {
    success: true,
    sessionDurationMs: 12_000,
    creditsBilled: 4,
  };
}

describe("handed-off browser cleanup", () => {
  it("captures a Playwright snapshot through the persisted connection", async () => {
    const close = vi.fn(async () => stoppedBrowser());
    const captureSnapshot = vi.fn(async () => '- button "Continue" [ref=e1]');

    const result = await finishHandedOffBrowser(
      { ...SESSION, captureEvidence: true },
      { captureSnapshot, close },
    );

    expect(captureSnapshot).toHaveBeenCalledExactlyOnceWith(SESSION.cdpUrl);
    expect(close).toHaveBeenCalledExactlyOnceWith(SESSION.providerSessionId);
    expect(result).toEqual({
      evidence: '- button "Continue" [ref=e1]',
      providerDurationMs: 12_000,
      creditsBilled: 4,
    });
  });

  it("still closes the browser when the final snapshot fails", async () => {
    const close = vi.fn(async () => stoppedBrowser());

    const result = await finishHandedOffBrowser(
      { ...SESSION, captureEvidence: true },
      {
        captureSnapshot: vi.fn(async () => {
          throw new Error("snapshot failed");
        }),
        close,
      },
    );

    expect(close).toHaveBeenCalledExactlyOnceWith(SESSION.providerSessionId);
    expect(result.evidence).toContain("snapshot failed");
  });

  it("does not connect when no final evidence was requested", async () => {
    const captureSnapshot = vi.fn();
    const close = vi.fn(async () => stoppedBrowser());

    const result = await finishHandedOffBrowser(
      { ...SESSION, captureEvidence: false },
      { captureSnapshot, close },
    );

    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith(SESSION.providerSessionId);
    expect(result.evidence).toContain("without a final browser snapshot");
  });
});
