export type EmailLink = {
  url: string;
  host: string;
  label: string;
};

const HTML_LINK_PATTERN = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const PLAIN_LINK_PATTERN = /https:\/\/[^\s<>"']+/gi;

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function addLink(links: EmailLink[], seen: Set<string>, href: string, label: string) {
  const decodedHref = decodeHtml(href).replace(/[),.;]+$/, "");
  let url: URL;
  try {
    url = new URL(decodedHref);
  } catch {
    return;
  }
  if (url.protocol !== "https:" || seen.has(url.toString())) {
    return;
  }

  seen.add(url.toString());
  links.push({
    url: url.toString(),
    host: url.host,
    label: stripHtml(label).slice(0, 160) || "Unlabelled link",
  });
}

export function extractEmailLinks(message: { html: string; text: string }) {
  const links: EmailLink[] = [];
  const seen = new Set<string>();

  for (const match of message.html.matchAll(HTML_LINK_PATTERN)) {
    addLink(links, seen, match[1] ?? "", match[2] ?? "");
  }
  for (const match of message.text.matchAll(PLAIN_LINK_PATTERN)) {
    addLink(links, seen, match[0], "Plain-text link");
  }

  return links;
}
