import { env } from "../../_generated/server";

const FIRECRAWL_BROWSER_URL = "https://api.firecrawl.dev/v2/browser";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPLAY_PAGES = 1_000;
const MAX_PLAYLIST_LENGTH = 1_000_000;
const PAGE_ID_PATTERN = /^\d{1,3}$/;

export type BrowserReplayPage = {
  pageId: string;
  pageUrl: string | null;
  startTimeMs: number;
  endTimeMs: number;
};

class FirecrawlReplayNotReadyError extends Error {}

export function isFirecrawlReplayNotReady(error: unknown) {
  return error instanceof FirecrawlReplayNotReadyError;
}

function authorizationHeaders(accept?: string) {
  const apiKey = env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  return accept
    ? { Authorization: `Bearer ${apiKey}`, Accept: accept }
    : { Authorization: `Bearer ${apiKey}` };
}

async function replayRequest(path: string, accept?: string) {
  const response = await fetch(`${FIRECRAWL_BROWSER_URL}/${path}`, {
    headers: authorizationHeaders(accept),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) throw new FirecrawlReplayNotReadyError();
  if (!response.ok) {
    throw new Error(`Firecrawl replay request failed with status ${response.status}`);
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Firecrawl replay response has an invalid ${field}`);
  }
  return value;
}

function safePageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function replayPage(value: unknown): BrowserReplayPage {
  const page = record(value, "Firecrawl replay page");
  const pageId = page["pageId"];
  if (typeof pageId !== "string" || !PAGE_ID_PATTERN.test(pageId)) {
    throw new Error("Firecrawl replay response has an invalid pageId");
  }
  const startTimeMs = timestamp(page["startTimeMs"], "startTimeMs");
  const endTimeMs = timestamp(page["endTimeMs"], "endTimeMs");
  if (endTimeMs < startTimeMs) {
    throw new Error("Firecrawl replay response has an invalid time range");
  }
  return {
    pageId,
    pageUrl: safePageUrl(page["pageUrl"]),
    startTimeMs,
    endTimeMs,
  };
}

export async function listBrowserReplayPages(sessionId: string) {
  const response = await replayRequest(`${encodeURIComponent(sessionId)}/replay`);
  const body: unknown = await response.json();
  const payload = record(body, "Firecrawl replay response");
  const pages = payload["pages"];
  if (payload["success"] !== true || !Array.isArray(pages)) {
    throw new Error("Firecrawl returned an invalid browser replay");
  }
  if (pages.length > MAX_REPLAY_PAGES) {
    throw new Error("Firecrawl replay contains too many pages");
  }
  return pages.map(replayPage);
}

export async function getBrowserReplayPlaylist(sessionId: string, pageId: string) {
  if (!PAGE_ID_PATTERN.test(pageId)) {
    throw new Error("Firecrawl replay page ID is invalid");
  }
  const response = await replayRequest(
    `${encodeURIComponent(sessionId)}/replay/${pageId}`,
    "application/vnd.apple.mpegurl",
  );
  const playlist = await response.text();
  if (!playlist.startsWith("#EXTM3U")) {
    throw new Error("Firecrawl returned an invalid replay playlist");
  }
  if (playlist.length > MAX_PLAYLIST_LENGTH) {
    throw new Error("Firecrawl replay playlist is too large");
  }
  return playlist;
}
