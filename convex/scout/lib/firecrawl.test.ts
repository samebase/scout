import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeScrapeInteractSession,
  createScrapeInteractSession,
  executeScrapeInteractCode,
  executeScrapeInteractPrompt,
} from "./firecrawl";

type CapturedRequest = {
  url: string;
  init: RequestInit | undefined;
};

const requests: CapturedRequest[] = [];
const responses: unknown[] = [];

function requestUrl(input: string | URL | Request) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
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

beforeEach(() => {
  process.env["FIRECRAWL_API_KEY"] = "test-key";
  requests.length = 0;
  responses.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: requestUrl(input), init });
    return Response.json(responses.shift());
  });
});

afterEach(() => {
  delete process.env["FIRECRAWL_API_KEY"];
  vi.unstubAllGlobals();
});

describe("scrape-bound Firecrawl Interact", () => {
  test("starts a writable named profile without exposing scrape content", async () => {
    responses.push({
      success: true,
      data: {
        markdown: "private page content",
        metadata: { scrapeId: "scrape-1" },
      },
    });

    await expect(
      createScrapeInteractSession("https://tally.so/login", "scout-conrad"),
    ).resolves.toEqual({ scrapeId: "scrape-1" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requestBody(requests[0])).toEqual({
      url: "https://tally.so/login",
      formats: ["markdown"],
      profile: { name: "scout-conrad", saveChanges: true },
      storeInCache: false,
    });
  });

  test("uses prompt and code modes on the same scrape session", async () => {
    responses.push(
      {
        success: true,
        liveViewUrl: "https://signed.example/live",
        output: "The login form is visible",
        exitCode: 0,
        killed: false,
      },
      {
        success: true,
        interactiveLiveViewUrl: "https://signed.example/control",
        result: '{"title":"Workspace"}',
        exitCode: 0,
        killed: false,
      },
    );

    const prompt = await executeScrapeInteractPrompt("scrape-1", "Find the login form", 60);
    const code = await executeScrapeInteractCode("scrape-1", "await page.title()", 30);

    expect(prompt.output).toBe("The login form is visible");
    expect(prompt.replayAvailable).toBe(true);
    expect(prompt).not.toHaveProperty("liveViewUrl");
    expect(prompt).not.toHaveProperty("interactiveLiveViewUrl");
    expect(code.result).toBe('{"title":"Workspace"}');
    expect(code.replayAvailable).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.firecrawl.dev/v2/scrape/scrape-1/interact",
      "https://api.firecrawl.dev/v2/scrape/scrape-1/interact",
    ]);
    expect(requestBody(requests[0])).toEqual({
      prompt: "Find the login form",
      timeout: 60,
      origin: "samebase-scout",
    });
    expect(requestBody(requests[1])).toEqual({
      code: "await page.title()",
      language: "node",
      timeout: 30,
      origin: "samebase-scout",
    });
  });

  test("stops the scrape session and keeps billing metrics", async () => {
    responses.push({
      success: true,
      sessionDurationMs: 61_500,
      creditsBilled: 14,
      signedReplayUrl: "https://signed.example/replay",
    });

    const stopped = await closeScrapeInteractSession("scrape-1");
    expect(stopped).toEqual({
      success: true,
      sessionDurationMs: 61_500,
      creditsBilled: 14,
      replayAvailable: true,
    });
    expect(stopped).not.toHaveProperty("signedReplayUrl");
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/scrape/scrape-1/interact");
    expect(requests[0]?.init?.method).toBe("DELETE");
  });
});
