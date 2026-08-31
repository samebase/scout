import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeBrowserSession,
  createBrowserSession,
  executeBrowserCode,
  findActiveBrowserSession,
  getBrowserReplayPlaylist,
  listBrowserReplayPages,
} from "./firecrawl";
import { fetchJson, ProviderHttpError } from "./http";

type CapturedRequest = {
  url: string;
  init: RequestInit | undefined;
};

const requests: CapturedRequest[] = [];
const responses: Array<Response | Error> = [];

function requestUrl(input: string | URL | Request) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(request: CapturedRequest | undefined): unknown {
  const body = request?.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

beforeEach(() => {
  process.env["FIRECRAWL_API_KEY"] = "test-key";
  requests.length = 0;
  responses.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: requestUrl(input), init });
    const response = responses.shift();
    if (!response) throw new Error("Missing mocked response");
    if (response instanceof Error) throw response;
    return response;
  });
});

afterEach(() => {
  delete process.env["FIRECRAWL_API_KEY"];
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("standalone Firecrawl Browser Sandbox", () => {
  test("starts a standalone session without a profile", async () => {
    responses.push(jsonResponse({ success: true, id: "session-fresh" }));

    await expect(createBrowserSession()).resolves.toEqual({
      sessionId: "session-fresh",
      liveViewUrl: null,
      interactiveLiveViewUrl: null,
    });
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/interact");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requestBody(requests[0])).toEqual({ recordSession: true, streamWebView: true });
  });

  test("returns validated read-only and interactive live views for a writable named profile", async () => {
    responses.push(
      jsonResponse({
        success: true,
        id: "session-1",
        cdpUrl: "wss://cdp-proxy.firecrawl.dev/private",
        liveViewUrl: "https://liveview.firecrawl.dev/private?signature=read-only",
        interactiveLiveViewUrl:
          "https://liveview.firecrawl.dev/private?signature=interactive-control",
      }),
    );

    await expect(createBrowserSession("scout-conrad")).resolves.toEqual({
      sessionId: "session-1",
      liveViewUrl: "https://liveview.firecrawl.dev/private?signature=read-only",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });
    expect(requests).toHaveLength(1);
    expect(requestBody(requests[0])).toEqual({
      recordSession: true,
      streamWebView: true,
      profile: { name: "scout-conrad", saveChanges: true },
    });
  });

  test("selects the exact active session and returns its current interactive URL", async () => {
    responses.push(
      jsonResponse({
        success: true,
        sessions: [
          {
            id: "session-other",
            status: "active",
            interactiveLiveViewUrl: "https://liveview.firecrawl.dev/other?signature=private",
          },
          {
            id: "session-1",
            status: "active",
            interactiveLiveViewUrl: "https://liveview.firecrawl.dev/session-1?signature=fresh",
          },
        ],
      }),
    );

    await expect(findActiveBrowserSession("session-1")).resolves.toEqual({
      sessionId: "session-1",
      interactiveLiveViewUrl: "https://liveview.firecrawl.dev/session-1?signature=fresh",
    });
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/browser?status=active");
  });

  test("rejects duplicate records for the bound provider session", async () => {
    responses.push(
      jsonResponse({
        success: true,
        sessions: [
          { id: "session-1", status: "active" },
          { id: "session-1", status: "active" },
        ],
      }),
    );

    await expect(findActiveBrowserSession("session-1")).rejects.toThrow(
      "duplicate browser session",
    );
  });

  test("loads replay metadata without exposing URL credentials or query parameters", async () => {
    responses.push(
      jsonResponse({
        success: true,
        pages: [
          {
            pageId: "1",
            pageUrl: "https://example.test/callback?code=secret#token",
            startTimeMs: 120,
            endTimeMs: 5_400,
          },
          {
            pageId: "2",
            pageUrl: "about:blank",
            startTimeMs: 6_000,
            endTimeMs: 7_000,
          },
        ],
      }),
    );

    await expect(listBrowserReplayPages("session-1")).resolves.toEqual([
      {
        pageId: "1",
        pageUrl: "https://example.test/callback",
        startTimeMs: 120,
        endTimeMs: 5_400,
      },
      {
        pageId: "2",
        pageUrl: null,
        startTimeMs: 6_000,
        endTimeMs: 7_000,
      },
    ]);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/interact/session-1/replay");
  });

  test("loads a fresh HLS replay playlist for one recorded page", async () => {
    const playlist = "#EXTM3U\n#EXT-X-VERSION:3\nhttps://recording.test/segment.ts?sig=fresh\n";
    responses.push(new Response(playlist));

    await expect(getBrowserReplayPlaylist("session-1", "2")).resolves.toBe(playlist);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/interact/session-1/replay/2");
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      Accept: "application/vnd.apple.mpegurl",
    });
  });

  test("rejects an invalid replay page before contacting Firecrawl", async () => {
    await expect(getBrowserReplayPlaylist("session-1", "../../secret")).rejects.toThrow(
      "Firecrawl replay page ID is invalid",
    );
    expect(requests).toHaveLength(0);
  });

  test.each([
    "http://liveview.firecrawl.dev/private",
    "https://api.firecrawl.dev/private",
    "https://liveview.firecrawl.dev.evil.test/private",
    "https://user:password@liveview.firecrawl.dev/private",
  ])("rejects an invalid provider live view URL: %s", async (liveViewUrl) => {
    responses.push(
      jsonResponse({ success: true, id: "session-1", liveViewUrl }),
      jsonResponse({ success: true }),
    );

    await expect(createBrowserSession()).rejects.toThrow(
      "Firecrawl returned an invalid live view URL",
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact",
      "https://api.firecrawl.dev/v2/interact/session-1",
    ]);
  });

  test("rejects and closes a session with an invalid interactive live view URL", async () => {
    responses.push(
      jsonResponse({
        success: true,
        id: "session-1",
        liveViewUrl: "https://liveview.firecrawl.dev/private?signature=read-only",
        interactiveLiveViewUrl: "https://attacker.test/takeover",
      }),
      jsonResponse({ success: true }),
    );

    await expect(createBrowserSession()).rejects.toThrow(
      "Firecrawl returned an invalid live view URL",
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact",
      "https://api.firecrawl.dev/v2/interact/session-1",
    ]);
  });

  test("executes code against the standalone session", async () => {
    responses.push(
      jsonResponse({
        success: true,
        result: '{"title":"Workspace"}',
        exitCode: 0,
        killed: false,
      }),
    );

    const code = await executeBrowserCode(
      "session-1",
      "agent-browser snapshot -i",
      30,
      "bash",
      "read",
    );

    expect(code.result).toBe('{"title":"Workspace"}');
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact/session-1/execute",
    ]);
    expect(requestBody(requests[0])).toEqual({
      code: "agent-browser snapshot -i",
      language: "bash",
      timeout: 30,
    });
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("aborts a never-settling execute request", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const abort = () => reject(signal?.reason ?? new Error("request aborted"));
            if (signal?.aborted) {
              abort();
            } else {
              signal?.addEventListener("abort", abort, { once: true });
            }
          }),
      ),
    );

    const execution = executeBrowserCode(
      "session-1",
      "agent-browser snapshot -i",
      30,
      "bash",
      "mutate",
    );
    controller.abort(new Error("execution transport deadline"));

    await expect(execution).rejects.toThrow("execution transport deadline");
    expect(timeout).toHaveBeenCalledWith(35_000);
  });

  test.each([
    { error: "locator click failed", killed: false, exitCode: 0 },
    { error: null, killed: true, exitCode: 0 },
    { error: null, killed: false, exitCode: 1 },
  ])("does not report documented execution failures as successful: %o", async (failure) => {
    responses.push(jsonResponse({ success: true, ...failure }));

    await expect(
      executeBrowserCode("session-1", "agent-browser click @e1", 30, "bash", "mutate"),
    ).resolves.toMatchObject({ success: false, ...failure });
  });

  test("preserves Retry-After and reset metadata on provider errors", async () => {
    vi.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
    responses.push(
      new Response("Rate limit exceeded; retry after 59s; resets at 2026-08-28T12:01:00.000Z", {
        status: 429,
        headers: { "Retry-After": "61" },
      }),
    );

    const error = await fetchJson("Firecrawl", "https://example.test", {}).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    if (!(error instanceof ProviderHttpError)) throw error;
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(61_000);
    expect(error.resetAtMs).toBe(Date.parse("2026-08-28T12:01:00.000Z"));
  });

  test("retries an explicitly rejected mutating command once", async () => {
    responses.push(
      new Response("retry after 0s", { status: 429 }),
      jsonResponse({ success: true, stdout: "clicked", exitCode: 0, killed: false }),
    );

    await expect(
      executeBrowserCode("session-1", "agent-browser click @e1", 30, "bash", "mutate"),
    ).resolves.toMatchObject({ success: true, stdout: "clicked" });
    expect(requests).toHaveLength(2);
  });

  test("honors a valid per-minute Retry-After before the one retry", async () => {
    vi.useFakeTimers();
    responses.push(
      new Response("rate limited", { status: 429, headers: { "Retry-After": "61" } }),
      jsonResponse({ success: true, stdout: "clicked", exitCode: 0, killed: false }),
    );

    const execution = executeBrowserCode(
      "session-1",
      "agent-browser click @e1",
      30,
      "bash",
      "mutate",
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(60_999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(execution).resolves.toMatchObject({ success: true });
    expect(requests).toHaveLength(2);
  });

  test("does not replay an ambiguous mutating failure", async () => {
    responses.push(
      new Response("upstream failed after accepting request", { status: 503 }),
      jsonResponse({ success: true }),
    );

    await expect(
      executeBrowserCode("session-1", "agent-browser click @e1", 30, "bash", "mutate"),
    ).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
  });

  test("does not replay an ambiguous mutating network failure", async () => {
    responses.push(new Error("connection reset"), jsonResponse({ success: true }));

    await expect(
      executeBrowserCode("session-1", "agent-browser click @e1", 30, "bash", "mutate"),
    ).rejects.toThrow("connection reset");
    expect(requests).toHaveLength(1);
  });

  test("stops the session after one explicit 429 and keeps billing metrics", async () => {
    responses.push(
      new Response("retry after 0s", { status: 429 }),
      jsonResponse({ success: true, sessionDurationMs: 61_500, creditsBilled: 14 }),
    );

    await expect(closeBrowserSession("session-1")).resolves.toEqual({
      success: true,
      sessionDurationMs: 61_500,
      creditsBilled: 14,
      replayAvailable: false,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/interact/session-1");
    expect(requests[0]?.init?.method).toBe("DELETE");
  });

  test("wires a 15-second deadline into DELETE without waiting in real time", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    responses.push(jsonResponse({ success: true }));

    await closeBrowserSession("session-1");

    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(requests[0]?.init?.signal).toBe(signal);
  });

  test.each([404, 410])("treats a later %s close as already closed", async (status) => {
    responses.push(new Response("session not found", { status }));

    await expect(closeBrowserSession("session-1")).resolves.toEqual({
      success: true,
      sessionDurationMs: null,
      creditsBilled: null,
      replayAvailable: false,
    });
    expect(requests).toHaveLength(1);
  });

  test("confirms a timed-out close when the exact session is no longer active", async () => {
    const timeoutError = new Error("The operation timed out");
    timeoutError.name = "TimeoutError";
    responses.push(
      timeoutError,
      jsonResponse({ success: true, sessions: [{ id: "session-other" }] }),
    );

    await expect(closeBrowserSession("session-1")).resolves.toEqual({
      success: true,
      sessionDurationMs: null,
      creditsBilled: null,
      replayAvailable: false,
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact/session-1",
      "https://api.firecrawl.dev/v2/interact?status=active",
    ]);
  });

  test("bounds active-session confirmation after an uncertain close", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    responses.push(
      new Error("connection reset"),
      jsonResponse({ success: true, sessions: [{ id: "session-other" }] }),
    );

    await closeBrowserSession("session-1");

    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenNthCalledWith(1, 15_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 15_000);
    expect(requests[1]?.init?.signal).toBe(signal);
  });

  test("preserves an uncertain close error while the exact session remains active", async () => {
    const closeError = new Error("connection reset");
    responses.push(closeError, jsonResponse({ success: true, sessions: [{ id: "session-1" }] }));

    await expect(closeBrowserSession("session-1")).rejects.toBe(closeError);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact/session-1",
      "https://api.firecrawl.dev/v2/interact?status=active",
    ]);
  });

  test("does not confirm an uncertain close when listing active sessions fails", async () => {
    responses.push(new Error("connection reset"), new Response("unauthorized", { status: 401 }));

    await expect(closeBrowserSession("session-1")).rejects.toMatchObject({ status: 401 });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/interact/session-1",
      "https://api.firecrawl.dev/v2/interact?status=active",
    ]);
  });

  test("does not probe active sessions after a definitive provider close error", async () => {
    responses.push(new Response("unauthorized", { status: 401 }));

    await expect(closeBrowserSession("session-1")).rejects.toMatchObject({ status: 401 });
    expect(requests).toHaveLength(1);
  });
});
