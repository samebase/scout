import { describe, expect, it, vi } from "vite-plus/test";
import { finishHandedOffBrowser } from "./taskHumanHandoffBrowser";

function stoppedBrowser() {
  return {
    success: true,
    sessionDurationMs: 12_000,
    creditsBilled: 4,
  };
}

describe("handed-off browser cleanup", () => {
  it("still closes the browser when active-session verification fails", async () => {
    const close = vi.fn(async () => stoppedBrowser());
    const result = await finishHandedOffBrowser(
      { providerSessionId: "session-1", captureEvidence: true },
      {
        find: vi.fn(async () => {
          throw new Error("provider read failed");
        }),
        captureSnapshot: vi.fn(),
        close,
      },
    );

    expect(close).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(result).toMatchObject({
      evidence: expect.stringContaining("provider read failed"),
      providerDurationMs: 12_000,
      creditsBilled: 4,
    });
  });

  it("still closes the browser when the final snapshot fails", async () => {
    const close = vi.fn(async () => stoppedBrowser());
    const result = await finishHandedOffBrowser(
      { providerSessionId: "session-1", captureEvidence: true },
      {
        find: vi.fn(async () => ({ sessionId: "session-1", interactiveLiveViewUrl: null })),
        captureSnapshot: vi.fn(async () => {
          throw new Error("snapshot failed");
        }),
        close,
      },
    );

    expect(close).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(result.evidence).toContain("snapshot failed");
  });

  it("does not treat a nonzero snapshot command as successful evidence", async () => {
    const close = vi.fn(async () => stoppedBrowser());
    const result = await finishHandedOffBrowser(
      { providerSessionId: "session-1", captureEvidence: true },
      {
        find: vi.fn(async () => ({ sessionId: "session-1", interactiveLiveViewUrl: null })),
        captureSnapshot: vi.fn(async () => ({
          success: true,
          stdout: "partial output",
          stderr: "snapshot failed",
          exitCode: 1,
          killed: false,
          error: "Execution failed",
        })),
        close,
      },
    );

    expect(result.evidence).toContain("snapshot failed");
    expect(result.evidence).not.toContain("partial output");
    expect(close).toHaveBeenCalledExactlyOnceWith("session-1");
  });

  it("records an already-ended provider session without closing it again", async () => {
    const close = vi.fn(async () => stoppedBrowser());
    const result = await finishHandedOffBrowser(
      { providerSessionId: "session-1", captureEvidence: true },
      {
        find: vi.fn(async () => null),
        captureSnapshot: vi.fn(),
        close,
      },
    );

    expect(close).not.toHaveBeenCalled();
    expect(result).toEqual({
      evidence: "The browser session ended before Scout could inspect the completed human step.",
      providerDurationMs: null,
      creditsBilled: null,
    });
  });
});
