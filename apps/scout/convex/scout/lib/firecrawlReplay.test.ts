import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  getBrowserReplayPlaylist,
  isFirecrawlReplayNotReady,
  listBrowserReplayPages,
} from "./firecrawlReplay";

type CapturedRequest = {
  url: string;
  init: RequestInit | undefined;
};

const requests: CapturedRequest[] = [];
const responses: Response[] = [];

function requestUrl(input: string | URL | Request) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  process.env["FIRECRAWL_API_KEY"] = "test-key";
  requests.length = 0;
  responses.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: requestUrl(input), init });
    const response = responses.shift();
    if (!response) throw new Error("Missing mocked response");
    return response;
  });
});

afterEach(() => {
  delete process.env["FIRECRAWL_API_KEY"];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Firecrawl browser replay", () => {
  test("uses the current invocation's key after the runtime replaces process.env", async () => {
    const previousEnvironment = process.env;
    try {
      process.env = { ...previousEnvironment, FIRECRAWL_API_KEY: "updated-key" };
      responses.push(Response.json({ success: true, pages: [] }));

      await listBrowserReplayPages("session-1");

      expect(requests[0]?.init?.headers).toEqual({ Authorization: "Bearer updated-key" });
    } finally {
      process.env = previousEnvironment;
    }
  });

  test("loads replay metadata and removes credentials from recorded page URLs", async () => {
    responses.push(
      Response.json({
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
      { pageId: "2", pageUrl: null, startTimeMs: 6_000, endTimeMs: 7_000 },
    ]);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/browser/session-1/replay");
  });

  test("loads one recorded page as an HLS playlist", async () => {
    const playlist = "#EXTM3U\n#EXT-X-VERSION:3\nhttps://recording.test/segment.ts?sig=fresh\n";
    responses.push(new Response(playlist));

    await expect(getBrowserReplayPlaylist("session-1", "2")).resolves.toBe(playlist);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/browser/session-1/replay/2");
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer test-key",
      Accept: "application/vnd.apple.mpegurl",
    });
  });

  test("rejects an invalid page ID before contacting Firecrawl", async () => {
    await expect(getBrowserReplayPlaylist("session-1", "../../secret")).rejects.toThrow(
      "Firecrawl replay page ID is invalid",
    );
    expect(requests).toHaveLength(0);
  });

  test("identifies a replay that Firecrawl has not prepared yet", async () => {
    responses.push(Response.json({ success: false, error: "Replay not found." }, { status: 404 }));

    const error = await listBrowserReplayPages("session-1").catch((caught: unknown) => caught);
    expect(isFirecrawlReplayNotReady(error)).toBe(true);
  });

  test("rejects malformed replay metadata", async () => {
    responses.push(Response.json({ success: true, pages: [{ pageId: "tab-a" }] }));

    await expect(listBrowserReplayPages("session-1")).rejects.toThrow(
      "Firecrawl replay response has an invalid pageId",
    );
  });
});
