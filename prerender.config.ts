type PrerenderPath = `/${string}`;

export type PrerenderPage = {
  path: PrerenderPath;
  prerender: {
    enabled: true;
    outputPath?: PrerenderPath;
  };
};

export type PrerenderPathRewrites = Readonly<Record<string, PrerenderPath>>;

function assertRootRelativePath(label: string, value: string): asserts value is PrerenderPath {
  if (!value.startsWith("/")) {
    throw new Error(`${label} must be root-relative: ${value}`);
  }
}

function readHtmlOutputPath(page: PrerenderPage) {
  if (page.path === "/" && !page.prerender.outputPath) {
    throw new Error(
      "The root prerender page must set outputPath because the SPA shell owns /index.html.",
    );
  }

  const outputPath = page.prerender.outputPath ?? `${page.path}/index.html`;
  const htmlOutputPath = outputPath.endsWith(".html") ? outputPath : `${outputPath}.html`;

  assertRootRelativePath("Prerender output path", htmlOutputPath);
  if (htmlOutputPath === "/index.html") {
    throw new Error(
      "Prerender pages must not output /index.html because the SPA shell serves that file for unknown app routes.",
    );
  }

  return htmlOutputPath;
}

function createRouteAliases(routePath: PrerenderPath): readonly PrerenderPath[] {
  if (routePath === "/") {
    return ["/"];
  }

  return [routePath, `${routePath}/`, `${routePath}/index.html`];
}

export function createPrerenderPathRewrites(
  pages: readonly PrerenderPage[],
): PrerenderPathRewrites {
  const rewrites: Record<string, PrerenderPath> = {};

  for (const page of pages) {
    const outputPath = readHtmlOutputPath(page);
    for (const alias of createRouteAliases(page.path)) {
      if (Object.hasOwn(rewrites, alias)) {
        throw new Error(`Duplicate prerender route alias: ${alias}`);
      }
      rewrites[alias] = outputPath;
    }
  }

  return Object.freeze(rewrites);
}

/**
 * Public pages that TanStack Start prerenders and both production hosts expose
 * through exact route aliases.
 *
 * Both hosts use /index.html as the route-neutral SPA shell. The real / route
 * is also prerendered, so write it to /_landing.html and map only exact / to
 * that file. Unknown app routes can then keep falling back to the SPA shell.
 */
export const prerenderPages = [
  {
    path: "/",
    prerender: {
      enabled: true,
      outputPath: "/_landing.html",
    },
  },
] as const satisfies readonly PrerenderPage[];

export const prerenderPathRewrites = createPrerenderPathRewrites(prerenderPages);

export function rewritePrerenderPath(path: string) {
  return Object.hasOwn(prerenderPathRewrites, path) ? prerenderPathRewrites[path] : path;
}
