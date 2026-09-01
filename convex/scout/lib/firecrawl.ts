"use node";

import {
  Firecrawl,
  SdkError,
  type BrowserDeleteResponse,
  type BrowserExecuteResponse,
  type FirecrawlClientOptions,
} from "firecrawl";
import { env } from "../../_generated/server";

type BrowserLifecycleClient = Pick<Firecrawl, "deleteBrowser" | "listBrowsers">;

export function createFirecrawlClient(options: Pick<FirecrawlClientOptions, "maxRetries"> = {}) {
  const apiKey = env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  return new Firecrawl({ apiKey, ...options });
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
