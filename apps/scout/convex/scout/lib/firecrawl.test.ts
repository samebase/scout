import { SdkError, type BrowserDeleteResponse, type BrowserListResponse } from "firecrawl";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  closeFirecrawlBrowserSession,
  createRecordedFirecrawlBrowser,
  firecrawlBrowserExecutionSucceeded,
} from "./firecrawl";
import { FirecrawlApiError } from "./firecrawlHttp";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
  test("sends recordSession in the HTTP body with profile and lifetime settings", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ success: true, id: "recorded-1", cdpUrl: "wss://browser.test/cdp" }),
    );
    vi.stubGlobal("fetch", fetch);
    const options = {
      streamWebView: true,
      ttl: 3600,
      activityTtl: 3600,
      profile: { name: "scout", saveChanges: true },
    };
    await expect(createRecordedFirecrawlBrowser(options)).resolves.toMatchObject({
      success: true,
      id: "recorded-1",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.firecrawl.dev/v2/browser");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-key");
    expect(init.body).toBe(JSON.stringify({ ...options, recordSession: true }));
  });

  test("preserves the provider error, status, code and request ID for profile-busy responses", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { error: "Another session is currently writing to this profile", code: "PROFILE_BUSY" },
        { status: 409, headers: { "x-request-id": "request-1" } },
      ),
    );
    await expect(createRecordedFirecrawlBrowser({})).rejects.toMatchObject({
      status: 409,
      message:
        "Firecrawl POST /v2/browser: HTTP 409. Another session is currently writing to this profile. PROFILE_BUSY. Request ID: request-1",
    });
    await expect(createRecordedFirecrawlBrowser({})).rejects.toBeInstanceOf(FirecrawlApiError);
  });
  test("distinguishes request success from remote code success", () => {
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
