import { fetchJson, requireEnv, requireRecord, requireString } from "./http";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const MAX_OUTPUT_LENGTH = 40_000;
const SCOUT_ORIGIN = "samebase-scout";

export type BrowserExecution = {
  success: boolean;
  stdout: string;
  result: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  error: string | null;
};

export type ScrapeInteraction = BrowserExecution & {
  output: string;
  replayAvailable: boolean;
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

function parseBrowserExecution(response: Record<string, unknown>): BrowserExecution {
  return {
    success: response["success"] === true,
    stdout: optionalString(response, "stdout"),
    result: printable(response["result"]),
    stderr: optionalString(response, "stderr"),
    exitCode: optionalNumber(response, "exitCode"),
    killed: response["killed"] === true,
    error: typeof response["error"] === "string" ? response["error"] : null,
  };
}

function parseScrapeInteraction(response: Record<string, unknown>): ScrapeInteraction {
  return {
    ...parseBrowserExecution(response),
    output: optionalString(response, "output"),
    replayAvailable:
      typeof response["liveViewUrl"] === "string" ||
      typeof response["interactiveLiveViewUrl"] === "string" ||
      typeof response["replayUrl"] === "string" ||
      typeof response["signedReplayUrl"] === "string",
  };
}

export async function createBrowserSession() {
  const response = requireRecord(
    await fetchJson("Firecrawl", `${FIRECRAWL_BASE_URL}/interact`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ttl: 1_800,
        activityTtl: 600,
        streamWebView: true,
      }),
    }),
    "Firecrawl",
  );

  if (response["success"] !== true) {
    throw new Error("Firecrawl did not create a browser session");
  }

  return {
    sessionId: requireString(response, "id", "Firecrawl"),
    liveViewUrl: requireString(response, "liveViewUrl", "Firecrawl"),
    interactiveLiveViewUrl: requireString(response, "interactiveLiveViewUrl", "Firecrawl"),
    expiresAt: requireString(response, "expiresAt", "Firecrawl"),
  };
}

export async function executeBrowserCode(
  sessionId: string,
  code: string,
  timeoutSeconds: number,
): Promise<BrowserExecution> {
  const response = requireRecord(
    await fetchJson(
      "Firecrawl",
      `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}/execute`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ code, language: "bash", timeout: timeoutSeconds }),
      },
    ),
    "Firecrawl",
  );

  return parseBrowserExecution(response);
}

export async function closeBrowserSession(sessionId: string) {
  const response = requireRecord(
    await fetchJson(
      "Firecrawl",
      `${FIRECRAWL_BASE_URL}/interact/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: headers(),
      },
    ),
    "Firecrawl",
  );

  return {
    success: response["success"] === true,
    sessionDurationMs:
      typeof response["sessionDurationMs"] === "number" ? response["sessionDurationMs"] : null,
    creditsBilled: typeof response["creditsBilled"] === "number" ? response["creditsBilled"] : null,
  };
}

export async function createScrapeInteractSession(url: string, profileName: string) {
  const response = requireRecord(
    await fetchJson("Firecrawl", `${FIRECRAWL_BASE_URL}/scrape`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        profile: { name: profileName, saveChanges: true },
        storeInCache: false,
      }),
    }),
    "Firecrawl",
  );
  if (response["success"] !== true) {
    throw new Error("Firecrawl did not create a scrape session");
  }

  const data = requireRecord(response["data"], "Firecrawl scrape data");
  const metadata = requireRecord(data["metadata"], "Firecrawl scrape metadata");
  return { scrapeId: requireString(metadata, "scrapeId", "Firecrawl") };
}

async function executeScrapeInteraction(
  scrapeId: string,
  body: Record<string, unknown>,
): Promise<ScrapeInteraction> {
  const response = requireRecord(
    await fetchJson(
      "Firecrawl",
      `${FIRECRAWL_BASE_URL}/scrape/${encodeURIComponent(scrapeId)}/interact`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...body, origin: SCOUT_ORIGIN }),
      },
    ),
    "Firecrawl",
  );
  return parseScrapeInteraction(response);
}

export async function executeScrapeInteractPrompt(
  scrapeId: string,
  prompt: string,
  timeoutSeconds: number,
) {
  return await executeScrapeInteraction(scrapeId, {
    prompt,
    timeout: timeoutSeconds,
  });
}

export async function executeScrapeInteractCode(
  scrapeId: string,
  code: string,
  timeoutSeconds: number,
) {
  return await executeScrapeInteraction(scrapeId, {
    code,
    language: "node",
    timeout: timeoutSeconds,
  });
}

export async function closeScrapeInteractSession(scrapeId: string) {
  const response = requireRecord(
    await fetchJson(
      "Firecrawl",
      `${FIRECRAWL_BASE_URL}/scrape/${encodeURIComponent(scrapeId)}/interact`,
      {
        method: "DELETE",
        headers: headers(),
      },
    ),
    "Firecrawl",
  );

  return {
    success: response["success"] === true,
    sessionDurationMs: optionalNumber(response, "sessionDurationMs"),
    creditsBilled: optionalNumber(response, "creditsBilled"),
    replayAvailable:
      typeof response["replayUrl"] === "string" || typeof response["signedReplayUrl"] === "string",
  };
}
