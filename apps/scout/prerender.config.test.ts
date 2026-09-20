import { expect, test } from "vite-plus/test";
import { prerenderPages, rewritePrerenderPath } from "./prerender.config";

test("public URLs resolve to prerendered HTML without taking the SPA fallback", () => {
  expect(rewritePrerenderPath("/")).toBe("/_landing.html");
  for (const path of ["/about", "/privacy", "/terms"]) {
    expect(rewritePrerenderPath(path)).toBe(`${path}/index.html`);
    expect(rewritePrerenderPath(`${path}/`)).toBe(`${path}/index.html`);
  }
  expect(prerenderPages.map((page) => page.prerender.outputPath)).not.toContain("/index.html");
});

test("dynamic app routes, auth endpoints, and assets keep their original paths", () => {
  for (const path of [
    "/tasks/review-123",
    "/sites/example.com",
    "/settings",
    "/api/auth/signin",
    "/assets/app.js",
    "/index.html",
  ])
    expect(rewritePrerenderPath(path)).toBe(path);
});
