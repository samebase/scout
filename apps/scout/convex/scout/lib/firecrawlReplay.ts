import { z } from "zod";
import { firecrawlRequest } from "./firecrawlHttp";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPLAY_PAGES = 1_000;
const MAX_PLAYLIST_LENGTH = 1_000_000;
const PAGE_ID_PATTERN = /^\d{1,3}$/;

async function replayRequest(path: string, accept?: string) {
  return await firecrawlRequest(`/v2/browser/${path}`, {
    headers: accept ? { Accept: accept } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function safePageUrl(value: unknown) {
  // Firecrawl's desktop recording has an empty URL; about:blank is a tab recording.
  if (value === "") return "";
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

const replayPageSchema = z
  .object({
    pageId: z
      .string({ error: "Firecrawl replay response has an invalid pageId" })
      .regex(PAGE_ID_PATTERN, { error: "Firecrawl replay response has an invalid pageId" }),
    pageUrl: z.unknown().transform(safePageUrl),
    startTimeMs: z
      .number({ error: "Firecrawl replay response has an invalid startTimeMs" })
      .finite({ error: "Firecrawl replay response has an invalid startTimeMs" })
      .nonnegative({ error: "Firecrawl replay response has an invalid startTimeMs" }),
    endTimeMs: z
      .number({ error: "Firecrawl replay response has an invalid endTimeMs" })
      .finite({ error: "Firecrawl replay response has an invalid endTimeMs" })
      .nonnegative({ error: "Firecrawl replay response has an invalid endTimeMs" }),
  })
  .refine((page) => page.endTimeMs >= page.startTimeMs, {
    error: "Firecrawl replay response has an invalid time range",
  });

const replayResponseSchema = z.object({
  success: z.literal(true),
  pages: z.array(replayPageSchema).max(MAX_REPLAY_PAGES, {
    error: "Firecrawl replay contains too many pages",
  }),
});

export type BrowserReplayPage = z.output<typeof replayPageSchema>;

export async function listBrowserReplayPages(sessionId: string) {
  const response = await replayRequest(`${encodeURIComponent(sessionId)}/replay`);
  const parsed = replayResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    const replayIssue = parsed.error.issues.find((issue) =>
      issue.message.startsWith("Firecrawl replay"),
    );
    throw new Error(replayIssue?.message ?? "Firecrawl returned an invalid browser replay");
  }
  return parsed.data.pages;
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
