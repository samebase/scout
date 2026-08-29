const FIRECRAWL_LIVE_VIEW_HOSTNAME = "liveview.firecrawl.dev";
const MAX_FIRECRAWL_LIVE_VIEW_URL_LENGTH = 4_096;

export function requireFirecrawlLiveViewUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FIRECRAWL_LIVE_VIEW_URL_LENGTH
  ) {
    throw new Error("Firecrawl returned an invalid live view URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Firecrawl returned an invalid live view URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== FIRECRAWL_LIVE_VIEW_HOSTNAME ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Firecrawl returned an invalid live view URL");
  }
  return url.toString();
}

export function optionalFirecrawlLiveViewUrl(value: unknown) {
  return value === undefined || value === null ? null : requireFirecrawlLiveViewUrl(value);
}
