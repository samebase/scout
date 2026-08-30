import {
  fetchJson,
  fetchText,
  ProviderHttpError,
  requireEnv,
  requireRecord,
  requireString,
} from "./http";
import { optionalFirecrawlLiveViewUrl } from "./firecrawlLiveView";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const MAX_OUTPUT_LENGTH = 40_000;
const MAX_RETRY_DELAY_MS = 65_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DELETE_TIMEOUT_MS = 15_000;
const CLOSE_CONFIRMATION_TIMEOUT_MS = 15_000;
const REPLAY_TIMEOUT_MS = 15_000;
const MAX_REPLAY_PAGES = 20;
const MAX_REPLAY_PLAYLIST_LENGTH = 1_000_000;
const REPLAY_PAGE_ID_PATTERN = /^\d{1,3}$/;

export type BrowserOperation = "read" | "mutate";

export type BrowserExecution = {
  success: boolean;
  stdout: string;
  result: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  error: string | null;
};

export type BrowserInteraction = BrowserExecution & {
  output: string;
  replayAvailable: boolean;
};

export type BrowserReplayPage = {
  pageId: string;
  pageUrl: string | null;
  startTimeMs: number;
  endTimeMs: number;
};

function headers() {
  return {
    Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

function optionalString(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" ? value.slice(0, MAX_OUTPUT_LENGTH) : "";
}

function printable(value: unknown) {
  if (typeof value === "string") {
    return value.slice(0, MAX_OUTPUT_LENGTH);
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value).slice(0, MAX_OUTPUT_LENGTH);
  } catch {
    return "[unprintable result]";
  }
}

function optionalNumber(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "number" ? value : null;
}

function replayTimestamp(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Firecrawl replay response has an invalid ${field}`);
  }
  return value;
}

function replayPageUrl(value: unknown) {
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

function replayPage(record: Record<string, unknown>): BrowserReplayPage {
  const pageId = requireString(record, "pageId", "Firecrawl replay");
  if (!REPLAY_PAGE_ID_PATTERN.test(pageId)) {
    throw new Error("Firecrawl replay response has an invalid pageId");
  }
  const startTimeMs = replayTimestamp(record, "startTimeMs");
  const endTimeMs = replayTimestamp(record, "endTimeMs");
  if (endTimeMs < startTimeMs) {
    throw new Error("Firecrawl replay response has an invalid time range");
  }
  return {
    pageId,
    pageUrl: replayPageUrl(record["pageUrl"]),
    startTimeMs,
    endTimeMs,
  };
}

function parseBrowserExecution(response: Record<string, unknown>): BrowserExecution {
  const exitCode = optionalNumber(response, "exitCode");
  const killed = response["killed"] === true;
  const rawError = response["error"];
  const error = typeof rawError === "string" && rawError.trim() ? rawError : null;
  return {
    success:
      response["success"] === true &&
      error === null &&
      !killed &&
      (exitCode === null || exitCode === 0),
    stdout: optionalString(response, "stdout"),
    result: printable(response["result"]),
    stderr: optionalString(response, "stderr"),
    exitCode,
    killed,
    error,
  };
}

function parseBrowserInteraction(response: Record<string, unknown>): BrowserInteraction {
  return {
    ...parseBrowserExecution(response),
    output: optionalString(response, "output"),
    replayAvailable:
      typeof response["replayUrl"] === "string" || typeof response["signedReplayUrl"] === "string",
  };
}

function retryDelay(error: ProviderHttpError) {
  const resetDelay = error.resetAtMs === null ? null : Math.max(0, error.resetAtMs - Date.now());
  return Math.min(error.retryAfterMs ?? resetDelay ?? DEFAULT_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function withBoundedRetry<T>(operation: BrowserOperation, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 429) {
      await wait(retryDelay(error));
      return await run();
    }
    const isRetryableReadFailure =
      operation === "read" &&
      (!(error instanceof ProviderHttpError) || (error.status >= 500 && error.status <= 599));
    if (!isRetryableReadFailure) throw error;
    await wait(DEFAULT_RETRY_DELAY_MS);
    return await run();
  }
}

export async function createBrowserSession(profileName?: string) {
  const response = requireRecord(
    await withBoundedRetry(
      "mutate",
      async () =>
        await fetchJson("Firecrawl", `${FIRECRAWL_BASE_URL}/interact`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            recordSession: true,
            streamWebView: true,
            ...(profileName ? { profile: { name: profileName, saveChanges: true } } : {}),
          }),
        }),
    ),
    "Firecrawl",
  );
  if (response["success"] !== true) {
    throw new Error("Firecrawl did not create a browser session");
  }

  const sessionId = requireString(response, "id", "Firecrawl");
  try {
    return {
      sessionId,
      liveViewUrl: optionalFirecrawlLiveViewUrl(response["liveViewUrl"]),
      interactiveLiveViewUrl: optionalFirecrawlLiveViewUrl(response["interactiveLiveViewUrl"]),
    };
  } catch (error) {
    try {
      await closeBrowserSession(sessionId);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Firecrawl returned an invalid live view URL and the browser session could not be closed",
      );
    }
    throw error;
  }
}

export async function listBrowserReplayPages(sessionId: string) {
  const response = requireRecord(
    await withBoundedRetry(
      "read",
      async () =>
        await fetchJson(
          "Firecrawl",
          `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}/replay`,
          {
            headers: headers(),
            signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
          },
        ),
    ),
    "Firecrawl",
  );
  if (response["success"] !== true || !Array.isArray(response["pages"])) {
    throw new Error("Firecrawl returned an invalid browser replay");
  }
  if (response["pages"].length > MAX_REPLAY_PAGES) {
    throw new Error("Firecrawl replay contains too many pages");
  }
  return response["pages"].map((page) => replayPage(requireRecord(page, "Firecrawl replay page")));
}

export async function getBrowserReplayPlaylist(sessionId: string, pageId: string) {
  if (!REPLAY_PAGE_ID_PATTERN.test(pageId)) {
    throw new Error("Firecrawl replay page ID is invalid");
  }
  const playlist = await withBoundedRetry(
    "read",
    async () =>
      await fetchText(
        "Firecrawl",
        `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}/replay/${pageId}`,
        {
          headers: {
            ...headers(),
            Accept: "application/vnd.apple.mpegurl",
          },
          signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
        },
      ),
  );
  if (!playlist.startsWith("#EXTM3U")) {
    throw new Error("Firecrawl returned an invalid replay playlist");
  }
  if (playlist.length > MAX_REPLAY_PLAYLIST_LENGTH) {
    throw new Error("Firecrawl replay playlist is too large");
  }
  return playlist;
}

async function executeBrowserInteraction(
  sessionId: string,
  body: Record<string, unknown>,
  operation: BrowserOperation,
): Promise<BrowserInteraction> {
  const response = requireRecord(
    await withBoundedRetry(
      operation,
      async () =>
        await fetchJson(
          "Firecrawl",
          `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}/execute`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(body),
          },
        ),
    ),
    "Firecrawl",
  );
  return parseBrowserInteraction(response);
}

export async function executeBrowserCode(
  sessionId: string,
  code: string,
  timeoutSeconds: number,
  language: "node" | "bash" = "node",
  operation: BrowserOperation = "mutate",
) {
  return await executeBrowserInteraction(
    sessionId,
    { code, language, timeout: timeoutSeconds },
    operation,
  );
}

function closedSessionWithoutMetrics() {
  return {
    success: true,
    sessionDurationMs: null,
    creditsBilled: null,
    replayAvailable: false,
  };
}

async function listActiveBrowserSessionIds() {
  const response = requireRecord(
    await withBoundedRetry(
      "read",
      async () =>
        await fetchJson("Firecrawl", `${FIRECRAWL_BASE_URL}/interact?status=active`, {
          headers: headers(),
          signal: AbortSignal.timeout(CLOSE_CONFIRMATION_TIMEOUT_MS),
        }),
    ),
    "Firecrawl",
  );
  if (response["success"] !== true || !Array.isArray(response["sessions"])) {
    throw new Error("Firecrawl returned an invalid browser session list");
  }
  return response["sessions"].map((session) =>
    requireString(requireRecord(session, "Firecrawl browser session"), "id", "Firecrawl"),
  );
}

export async function closeBrowserSession(sessionId: string) {
  let response: Record<string, unknown>;
  try {
    response = requireRecord(
      await withBoundedRetry(
        "mutate",
        async () =>
          await fetchJson(
            "Firecrawl",
            `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}`,
            {
              method: "DELETE",
              headers: headers(),
              signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
            },
          ),
      ),
      "Firecrawl",
    );
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      if (error.status === 404 || error.status === 410) {
        return closedSessionWithoutMetrics();
      }
      throw error;
    }
    const activeSessionIds = await listActiveBrowserSessionIds();
    if (!activeSessionIds.includes(sessionId)) {
      return closedSessionWithoutMetrics();
    }
    throw error;
  }

  return {
    success: response["success"] === true,
    sessionDurationMs: optionalNumber(response, "sessionDurationMs"),
    creditsBilled: optionalNumber(response, "creditsBilled"),
    replayAvailable: false,
  };
}
