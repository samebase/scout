import { z } from "zod";
import { siteHostnameSchema } from "../../shared/site";

export const researchPage = z.object({
  markdown: z.string().trim().min(1).max(60_000),
  links: z.array(z.string()).default([]),
  metadata: z.object({
    statusCode: z.number().int().min(200).max(299),
    title: z.string().nullish(),
    sourceURL: z.string().nullish(),
    creditsUsed: z.number().nonnegative().nullish(),
    error: z.null().optional(),
  }),
});

export const sourceSelection = z.object({
  pages: z.array(z.object({ index: z.number().int().nonnegative(), reason: z.string() })).max(2),
  reason: z.string(),
});

export const siteBrief = z.object({
  overview: z.string().max(1_000),
  facts: z
    .array(
      z.object({
        text: z.string().max(1_000),
        sources: z.array(z.number().int().nonnegative()).min(1).max(6),
      }),
    )
    .max(4),
  unknowns: z.array(z.string().max(500)).max(3),
});

export function researchSite(prompt: string) {
  const urls = [...prompt.matchAll(/https?:\/\/[^\s<>"'`]+/g)].map((match) =>
    URL.parse(match[0].replace(/[.,;!?\])}]+$/, "")),
  );
  if (urls.length === 0 || urls.some((url) => url === null)) return null;
  const hosts = new Set<string>();
  for (const url of urls) {
    if (
      !url ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !siteHostnameSchema.safeParse(url.hostname).success ||
      /^[\d.]+$/.test(url.hostname) ||
      /\.(local|internal|localhost)$/.test(url.hostname)
    )
      return null;
    hosts.add(url.hostname);
  }
  // Research public homepages, never invitation tokens or signed-in URL paths.
  return hosts.size === 1 ? [...hosts][0] : null;
}

export function researchCandidates(site: string, links: { url: string; title: string }[]) {
  const unique = new Map<string, { url: string; title: string }>();
  for (const link of links) {
    const url = URL.parse(link.url, `https://${site}/`);
    if (
      !url ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.href === `https://${site}/` ||
      (url.hostname !== site && !url.hostname.endsWith(`.${site}`))
    )
      continue;
    unique.set(url.href, { url: url.href, title: link.title });
  }
  return [...unique.values()].slice(0, 50);
}

export function selectedPages(
  selection: z.infer<typeof sourceSelection>,
  candidates: ReturnType<typeof researchCandidates>,
) {
  if (new Set(selection.pages.map((page) => page.index)).size !== selection.pages.length)
    throw new Error("Model selected the same source more than once");
  return selection.pages.map(({ index }) => {
    const candidate = candidates[index];
    if (!candidate) throw new Error("Model selected a source outside the candidate list");
    return candidate;
  });
}

export type ResearchSource = {
  kind: "page" | "guide";
  path: string;
  url: string;
  retrievedAt: string;
  text: string;
};

export function renderBrief(
  site: string,
  brief: z.infer<typeof siteBrief>,
  sources: ResearchSource[],
) {
  for (const fact of brief.facts) {
    if (fact.sources.some((index) => sources[index] === undefined))
      throw new Error("Brief cites a source that was not read");
  }
  return [
    `# ${site}`,
    `Gathered ${new Date().toISOString()}. Public research, not a completed product test.`,
    brief.overview,
    ...brief.facts.map(
      (fact) =>
        `- ${fact.text} ${fact.sources.map((index) => `[${index + 1}](${sources[index].path})`).join(" ")}`,
    ),
    ...(brief.unknowns.length ? ["## Unknowns", ...brief.unknowns.map((text) => `- ${text}`)] : []),
    "## Sources",
    ...sources.map(
      (source, index) =>
        `${index + 1}. [${source.kind === "guide" ? "Historical guide" : source.url}](${source.path})`,
    ),
  ].join("\n\n");
}
