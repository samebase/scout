import { fetchJson, requireEnv, requireRecord, requireString } from "./http";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const MAX_OUTPUT_LENGTH = 40_000;

export type BrowserExecution = {
  success: boolean;
  stdout: string;
  result: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  error: string | null;
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

  return {
    success: response["success"] === true,
    stdout: optionalString(response, "stdout"),
    result: printable(response["result"]),
    stderr: optionalString(response, "stderr"),
    exitCode: typeof response["exitCode"] === "number" ? response["exitCode"] : null,
    killed: response["killed"] === true,
    error: typeof response["error"] === "string" ? response["error"] : null,
  };
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
