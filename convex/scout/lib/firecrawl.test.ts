import { SdkError, type BrowserDeleteResponse, type BrowserListResponse } from "firecrawl";
import { describe, expect, test, vi } from "vite-plus/test";
import { closeFirecrawlBrowserSession, firecrawlBrowserExecutionSucceeded } from "./firecrawl";

function browserLifecycle() {
  return {
    deleteBrowser: vi.fn(
      async (): Promise<BrowserDeleteResponse> => ({
        success: true,
        sessionDurationMs: 1_500,
        creditsBilled: 2,
      }),
    ),
    listBrowsers: vi.fn(
      async (): Promise<BrowserListResponse> => ({ success: true, sessions: [] }),
    ),
  };
}

describe("Firecrawl browser SDK boundary", () => {
  test("distinguishes request success from remote command success", () => {
    expect(firecrawlBrowserExecutionSucceeded({ success: true, exitCode: 0, killed: false })).toBe(
      true,
    );
    expect(
      firecrawlBrowserExecutionSucceeded({
        success: true,
        exitCode: 1,
        killed: false,
        error: "Execution failed",
      }),
    ).toBe(false);
    expect(firecrawlBrowserExecutionSucceeded({ success: true, exitCode: 0, killed: true })).toBe(
      false,
    );
    expect(firecrawlBrowserExecutionSucceeded({ success: false, exitCode: 0, killed: false })).toBe(
      false,
    );
  });

  test.each([404, 410])("treats a %s close response as already closed", async (status) => {
    const firecrawl = browserLifecycle();
    firecrawl.deleteBrowser.mockRejectedValueOnce(new SdkError("Browser session is gone", status));

    await expect(closeFirecrawlBrowserSession(firecrawl, "session-1")).resolves.toEqual({
      success: true,
    });
    expect(firecrawl.listBrowsers).not.toHaveBeenCalled();
  });

  test("confirms an ambiguous close through the active-session list", async () => {
    const firecrawl = browserLifecycle();
    firecrawl.deleteBrowser.mockRejectedValueOnce(new SdkError("socket reset"));

    await expect(closeFirecrawlBrowserSession(firecrawl, "session-1")).resolves.toEqual({
      success: true,
    });
    expect(firecrawl.listBrowsers).toHaveBeenCalledExactlyOnceWith({ status: "active" });
  });

  test("preserves an ambiguous close failure while the session remains active", async () => {
    const firecrawl = browserLifecycle();
    const failure = new SdkError("socket reset");
    firecrawl.deleteBrowser.mockRejectedValueOnce(failure);
    firecrawl.listBrowsers.mockResolvedValueOnce({
      success: true,
      sessions: [
        {
          id: "session-1",
          status: "active",
          cdpUrl: "wss://browser.firecrawl.dev/session-1",
          liveViewUrl: "https://liveview.firecrawl.dev/session-1",
          streamWebView: true,
          createdAt: "2026-09-02T00:00:00.000Z",
          lastActivity: "2026-09-02T00:00:00.000Z",
        },
      ],
    });

    await expect(closeFirecrawlBrowserSession(firecrawl, "session-1")).rejects.toBe(failure);
  });

  test("does not reinterpret a confirmed provider error as a successful close", async () => {
    const firecrawl = browserLifecycle();
    const failure = new SdkError("Browser release was not confirmed", 502);
    firecrawl.deleteBrowser.mockRejectedValueOnce(failure);

    await expect(closeFirecrawlBrowserSession(firecrawl, "session-1")).rejects.toBe(failure);
    expect(firecrawl.listBrowsers).not.toHaveBeenCalled();
  });
});
