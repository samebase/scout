// Data pages use live SSR or the universal SPA shell. Only data-free pages
// prerender, so builds can run before a new deployment's backend exists.
export const prerenderPages = [
  { path: "/about", prerender: { outputPath: "/about/index.html" } },
  { path: "/privacy", prerender: { outputPath: "/privacy/index.html" } },
  { path: "/terms", prerender: { outputPath: "/terms/index.html" } },
];

export const prerenderPathRewrites = new Map(
  prerenderPages.flatMap(({ path, prerender }) =>
    [path, `${path}/`].map((alias): [string, string] => [alias, prerender.outputPath]),
  ),
);

export function rewritePrerenderPath(path: string) {
  return prerenderPathRewrites.get(path) ?? path;
}
