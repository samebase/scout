// Both hosts reserve /index.html for app-route fallback. Serve the prerendered
// homepage through an exact alias, as in the Samebase SPA + SSG setup.
export const prerenderPages = [
  { path: "/", prerender: { outputPath: "/_landing.html" } },
  { path: "/about", prerender: { outputPath: "/about/index.html" } },
  { path: "/privacy", prerender: { outputPath: "/privacy/index.html" } },
  { path: "/terms", prerender: { outputPath: "/terms/index.html" } },
];

export const prerenderPathRewrites = new Map(
  prerenderPages.flatMap(({ path, prerender }) =>
    (path === "/" ? [path] : [path, `${path}/`]).map((alias): [string, string] => [
      alias,
      prerender.outputPath,
    ]),
  ),
);

export function rewritePrerenderPath(path: string) {
  return prerenderPathRewrites.get(path) ?? path;
}
