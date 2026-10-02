export function requireFirecrawlLiveViewUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Firecrawl returned an invalid live view URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Firecrawl returned an invalid live view URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Firecrawl returned an invalid live view URL");
  }
  return url.toString();
}

export function optionalFirecrawlLiveViewUrl(value: unknown) {
  return value === undefined || value === null ? null : requireFirecrawlLiveViewUrl(value);
}
