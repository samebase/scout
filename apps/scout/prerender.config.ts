// Data pages render per request. Only data-free pages prerender, so builds can run before a new
// deployment's backend exists.
export const prerenderPages = [
  { path: "/about", prerender: { outputPath: "/about/index.html" } },
  { path: "/privacy", prerender: { outputPath: "/privacy/index.html" } },
  { path: "/terms", prerender: { outputPath: "/terms/index.html" } },
];
