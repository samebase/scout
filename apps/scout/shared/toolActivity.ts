import { v, type Infer } from "convex/values";
import { z } from "zod";

export const toolActivityValidator = v.object({
  id: v.string(),
  name: v.string(),
  state: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("interrupted"),
  ),
  input: v.union(v.string(), v.null()),
  output: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  preview: v.union(v.string(), v.null()),
  links: v.array(v.object({ label: v.string(), url: v.string() })),
  captures: v.array(v.id("agentsApiScreenshots")),
});

export type ToolActivity = Infer<typeof toolActivityValidator>;

export const memberTranscriptItemValidator = v.union(
  v.object({
    kind: v.literal("message"),
    id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
  }),
  v.object({ kind: v.literal("tool"), id: v.string(), tool: toolActivityValidator }),
);

export type MemberTranscriptItem = Infer<typeof memberTranscriptItemValidator>;

export function safeToolActivityUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.hostname === "liveview.firecrawl.dev" || url.hostname === "live.browserbase.com")
      return null;
    const sensitiveParameter =
      /password|passwd|secret|token|authorization|cookie|credential|api.?key|signature|^(?:code|sig|key|session)$/i;
    const keys = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
    if (keys.some((key) => sensitiveParameter.test(key))) return null;
    return url.href;
  } catch {
    return null;
  }
}

const toolOutputJson = z.json();

// Only structured output URL fields become links. Prose and code are never scanned for links.
export function toolActivityLinks(output: unknown): ToolActivity["links"] {
  const links = new Map<string, string>();
  function visit(value: z.infer<typeof toolOutputJson>, depth: number) {
    if (depth > 12 || links.size >= 12) return;
    if (typeof value === "string") {
      try {
        visit(toolOutputJson.parse(JSON.parse(value)), depth + 1);
      } catch {
        /* Plain text has no structured links. */
      }
      return;
    }
    const part = value;
    if (Array.isArray(part)) {
      part.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!part || typeof part !== "object") return;
    for (const [key, entry] of Object.entries(part)) {
      if (/password|secret|token|credential|cdp|live.?view/i.test(key)) continue;
      if (/^(url|sourceUrl|requestedUrl|currentUrl)$/i.test(key) && typeof entry === "string") {
        const url = safeToolActivityUrl(entry);
        if (url)
          links.set(
            url,
            typeof part["title"] === "string" ? part["title"].slice(0, 120) : new URL(url).hostname,
          );
      } else visit(entry, depth + 1);
    }
  }
  const parsed = toolOutputJson.safeParse(output);
  if (parsed.success) visit(parsed.data, 0);
  return [...links].slice(0, 12).map(([url, label]) => ({ label, url }));
}
