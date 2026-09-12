const MAX_FIRECRAWL_CDP_URL_LENGTH = 4_096;

export function requireFirecrawlCdpUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FIRECRAWL_CDP_URL_LENGTH
  ) {
    throw new Error("Firecrawl returned an invalid browser CDP URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Firecrawl returned an invalid browser CDP URL");
  }
  if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") {
    throw new Error("Firecrawl returned an invalid browser CDP URL");
  }
  return url.toString();
}
