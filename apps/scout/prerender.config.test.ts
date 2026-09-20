import staticHosting from "@convex-dev/static-hosting/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { prerenderPages, rewriteStaticPath } from "./prerender.config";

test("public URLs resolve to prerendered HTML without taking the SPA fallback", () => {
  expect(rewriteStaticPath("/")).toBe("/_landing.html");
  for (const path of ["/about", "/privacy", "/terms"]) {
    expect(rewriteStaticPath(path)).toBe(`${path}/index.html`);
    expect(rewriteStaticPath(`${path}/`)).toBe(`${path}/index.html`);
  }
  expect(prerenderPages.map((page) => page.prerender.outputPath)).not.toContain("/index.html");
});

test("other app routes, auth endpoints, and assets keep their original paths", () => {
  for (const path of [
    "/tasks/review-123",
    "/settings",
    "/api/auth/signin",
    "/assets/app.js",
    "/sites/example.com/missing.js",
    "/index.html",
  ])
    expect(rewriteStaticPath(path)).toBe(path);
});

test("static hosting resolves direct site links to the app shell while missing assets stay missing", async () => {
  const backend = convexTest(staticHosting.schema, staticHosting.modules);
  await backend.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["<html>Scout app shell</html>"]));
    await ctx.db.insert("staticAssets", {
      path: "/index.html",
      storageId,
      contentType: "text/html; charset=utf-8",
      deploymentId: "test",
    });
  });
  const resolveAsset = makeFunctionReference<"query">("lib:resolveAssetForHttp");
  for (const path of [
    "/sites/necessary-cobra-892.convex.site?scope=public",
    "/sites/example.com",
    "/sites/example.com/?scope=mine",
  ]) {
    const url = new URL(path, "https://scout.example");
    const asset = await backend.query(resolveAsset, {
      path: rewriteStaticPath(url.pathname),
      spaFallback: true,
    });
    expect(asset).toMatchObject({ contentType: "text/html; charset=utf-8" });
  }
  for (const path of ["/assets/missing.js", "/missing.png", "/sites/example.com/missing.js"]) {
    expect(
      await backend.query(resolveAsset, { path: rewriteStaticPath(path), spaFallback: true }),
    ).toBeNull();
  }
});
