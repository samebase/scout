"use node";

import {
  Firecrawl,
  SdkError,
  type BrowserDeleteResponse,
  type BrowserExecuteResponse,
} from "firecrawl";
import { getRuntimeEnv } from "../../runtimeEnv";
import { optionalFirecrawlLiveViewUrl } from "./firecrawlLiveView";

type BrowserLifecycleClient = Pick<Firecrawl, "deleteBrowser" | "listBrowsers">;
const FIRECRAWL_REQUEST_TIMEOUT_MS = 60_000;

export function createFirecrawlClient() {
  const apiKey = getRuntimeEnv("FIRECRAWL_API_KEY")?.trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  return new Firecrawl({
    apiKey,
    // Firecrawl counts total attempts here, so one means no automatic retry.
    maxRetries: 1,
    timeoutMs: FIRECRAWL_REQUEST_TIMEOUT_MS,
  });
}

export function firecrawlBrowserExecutionSucceeded(response: BrowserExecuteResponse) {
  const exitCode: number | null | undefined = response.exitCode;
  return (
    response.success &&
    !response.error?.trim() &&
    response.killed !== true &&
    (exitCode === undefined || exitCode === null || exitCode === 0)
  );
}

export async function recoverActiveFirecrawlBrowserSession(providerSessionId: string) {
  const response = await createFirecrawlClient().listBrowsers({ status: "active" });
  if (!response.success) {
    throw new Error(response.error?.trim() || "Firecrawl could not list browser sessions");
  }
  const session = response.sessions?.find(
    (candidate) => candidate.id === providerSessionId && candidate.status === "active",
  );
  return session
    ? {
        providerSessionId: session.id,
        cdpUrl: session.cdpUrl,
        interactiveLiveViewUrl: optionalFirecrawlLiveViewUrl(session.interactiveLiveViewUrl),
      }
    : null;
}

export async function closeFirecrawlBrowserSession(
  firecrawl: BrowserLifecycleClient,
  sessionId: string,
): Promise<BrowserDeleteResponse> {
  try {
    return await firecrawl.deleteBrowser(sessionId);
  } catch (error) {
    if (!(error instanceof SdkError)) throw error;
    if (error.status === 404 || error.status === 410) return { success: true };
    if (error.status !== undefined) throw error;

    let activeSessions: Awaited<ReturnType<BrowserLifecycleClient["listBrowsers"]>>;
    try {
      activeSessions = await firecrawl.listBrowsers({ status: "active" });
    } catch {
      throw error;
    }
    if (!activeSessions.success || !activeSessions.sessions) throw error;
    const stillActive = activeSessions.sessions.some(
      (session) => session.id === sessionId && session.status === "active",
    );
    if (stillActive) throw error;
    return { success: true };
  }
}
