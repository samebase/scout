import staticHosting from "@convex-dev/static-hosting/test";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vite-plus/test";

const lib = anyApi["lib"];
const day = 24 * 60 * 60 * 1000;

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
  return convexTest(staticHosting.schema, staticHosting.modules);
}

type Backend = ReturnType<typeof setup>;

async function stage(backend: Backend, deploymentId: string, paths: string[]) {
  const assets = await backend.run(async (ctx) => {
    const result = [];
    for (const path of paths) {
      const storageId = await ctx.storage.store(new Blob([path]));
      result.push({
        path,
        storageId,
        contentType: path.endsWith(".html") ? "text/html" : "application/javascript",
        deploymentId,
      });
    }
    return result;
  });
  await backend.mutation(lib["stageAssets"], { assets });
  return assets;
}

async function publish(backend: Backend, deploymentId: string, paths: string[]) {
  const assets = await stage(backend, deploymentId, [
    "/index.html",
    `/.well-known/scout-build/${deploymentId}.txt`,
    ...paths,
  ]);
  await backend.mutation(lib["publishDeployment"], {
    currentDeploymentId: deploymentId,
    expectedAssetCount: assets.length,
    spaFallback: true,
  });
  return assets;
}

function resolve(backend: Backend, path: string) {
  return backend.query(lib["resolveAssetForHttp"], { path, spaFallback: false });
}

afterEach(() => vi.useRealTimers());

test("missing bundled assets remain uncached 404s when SPA fallback is enabled", async () => {
  const backend = setup();
  await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  expect(
    await backend.query(lib["resolveAssetForHttp"], {
      path: "/assets/missing-AbCdEfGh.js",
      spaFallback: true,
    }),
  ).toBeNull();
  const response = await backend.fetch("/assets/missing-AbCdEfGh.js");
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("Not Found");
});

test("keeps multiple releases' bundled assets while retiring HTML and readiness markers", async () => {
  const backend = setup();
  const first = await publish(backend, "A", [
    "/assets/page-AbCdEfGh.js",
    "/assets/style-CprUfdoC.css",
    "/assets/document.html",
  ]);
  await publish(backend, "B", ["/assets/page-BbCdEfGh.js"]);
  await publish(backend, "C", ["/assets/page-CbCdEfGh.js"]);
  await backend.mutation(lib["cleanupPendingStorage"], {});

  for (const path of [
    "/assets/page-AbCdEfGh.js",
    "/assets/style-CprUfdoC.css",
    "/assets/page-BbCdEfGh.js",
    "/assets/page-CbCdEfGh.js",
  ]) {
    expect(await resolve(backend, path)).toMatchObject({ storageUrl: expect.any(String) });
  }
  expect(await resolve(backend, "/assets/document.html")).toBeNull();
  expect(await resolve(backend, "/.well-known/scout-build/A.txt")).toBeNull();
  expect(await resolve(backend, "/.well-known/scout-build/C.txt")).not.toBeNull();
  expect(await backend.run((ctx) => ctx.db.system.get(first[0].storageId))).not.toBeNull();
  expect(await backend.run((ctx) => ctx.db.query("staticAssets").collect())).toHaveLength(3);
});

test("a failed publication preserves the current release and its retained predecessor", async () => {
  const backend = setup();
  await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  await publish(backend, "B", ["/assets/page-BbCdEfGh.js"]);
  const failed = await stage(backend, "C", ["/assets/page-CbCdEfGh.js"]);
  await expect(
    backend.mutation(lib["publishDeployment"], {
      currentDeploymentId: "C",
      expectedAssetCount: failed.length,
    }),
  ).rejects.toThrow("must include /index.html");
  await backend.mutation(lib["discardStagedDeployment"], { deploymentId: "C" });
  await backend.mutation(lib["deleteUploadedFiles"], {
    storageIds: failed.map((asset) => asset.storageId),
  });
  expect(await resolve(backend, "/assets/page-AbCdEfGh.js")).not.toBeNull();
  expect(await resolve(backend, "/assets/page-BbCdEfGh.js")).not.toBeNull();
  expect(await resolve(backend, "/assets/page-CbCdEfGh.js")).toBeNull();
  expect(await backend.query(lib["getCurrentDeployment"], {})).toMatchObject({
    currentDeploymentId: "B",
  });
});

test("all upload cleanup paths preserve files referenced by retired releases", async () => {
  const backend = setup();
  const first = await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  const asset = first.find((entry) => entry.path.startsWith("/assets/"))!;
  await publish(backend, "B", ["/assets/page-BbCdEfGh.js"]);
  await backend.run(async (ctx) => {
    await ctx.db.insert("pendingStorageCleanup", { storageId: asset.storageId });
    await ctx.db.insert("stagedAssets", { ...asset, deploymentId: "abandoned" });
  });
  vi.setSystemTime(Date.now() + 2 * day);
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(
    await backend.mutation(lib["deleteUploadedFiles"], { storageIds: [asset.storageId] }),
  ).toEqual({ deleted: 0, alreadyMissing: 0, stillReferenced: 1 });
  await backend.mutation(lib["cleanupAbandonedStaging"], {});
  await backend.mutation(lib["cleanupUnreferencedStorage"], {});
  expect(await backend.run((ctx) => ctx.db.system.get(asset.storageId))).not.toBeNull();
  expect(await resolve(backend, asset.path)).not.toBeNull();
});

test("expiry starts at retirement and a rollback's active storage survives old archive cleanup", async () => {
  const backend = setup();
  const first = await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  const original = first.find((entry) => entry.path.startsWith("/assets/"))!;
  vi.setSystemTime(Date.now() + 10 * day);
  await publish(backend, "B", ["/assets/page-BbCdEfGh.js"]);
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(await resolve(backend, original.path)).not.toBeNull();
  vi.setSystemTime(Date.now() + 6 * day);
  const rollback = await publish(backend, "A-again", [original.path]);
  const active = rollback.find((entry) => entry.path === original.path)!;
  expect(await resolve(backend, original.path)).toMatchObject({ etag: `"${active.storageId}"` });
  vi.setSystemTime(Date.now() + 2 * day);
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(await backend.run((ctx) => ctx.storage.get(original.storageId))).toBeNull();
  expect(await backend.run((ctx) => ctx.db.system.get(active.storageId))).not.toBeNull();
  expect(await resolve(backend, original.path)).toMatchObject({ etag: `"${active.storageId}"` });
});

test("expired archive cleanup is bounded and protects storage reused by the current manifest", async () => {
  const backend = setup();
  const first = await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  const reused = first.find((entry) => entry.path.startsWith("/assets/"))!;
  await publish(backend, "B", ["/assets/page-BbCdEfGh.js"]);
  await backend.run(async (ctx) => {
    await ctx.db.insert("staticAssets", { ...reused, deploymentId: "B" });
    for (let index = 0; index < 256; index++) {
      await ctx.db.insert("retiredAssets", {
        ...reused,
        path: `/assets/old-${index}.js`,
        expiresAt: Date.now() + 7 * day,
      });
    }
  });
  vi.setSystemTime(Date.now() + 8 * day);
  expect(await backend.mutation(lib["cleanupPendingStorage"], {})).toMatchObject({
    needsAnotherPass: true,
  });
  expect(await backend.run((ctx) => ctx.db.query("retiredAssets").first())).not.toBeNull();
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(await backend.run((ctx) => ctx.db.query("retiredAssets").first())).toBeNull();
  expect(await backend.run((ctx) => ctx.db.system.get(reused.storageId))).not.toBeNull();
});

test("keeps resolved old storage URLs and serves the newest archive after a path is retired twice", async () => {
  const backend = setup();
  const first = await publish(backend, "A", ["/assets/page-AbCdEfGh.js"]);
  const original = first.find((entry) => entry.path.startsWith("/assets/"))!;
  vi.setSystemTime(Date.now() + day);
  const replacement = await publish(backend, "B", [original.path]);
  const newer = replacement.find((entry) => entry.path === original.path)!;
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(await backend.run((ctx) => ctx.db.system.get(original.storageId))).not.toBeNull();
  expect(await resolve(backend, original.path)).toMatchObject({ etag: `"${newer.storageId}"` });

  vi.setSystemTime(Date.now() + 2 * day);
  await publish(backend, "C", ["/assets/page-CbCdEfGh.js"]);
  expect(await resolve(backend, original.path)).toMatchObject({ etag: `"${newer.storageId}"` });
  vi.setSystemTime(Date.now() + 6 * day);
  await backend.mutation(lib["cleanupPendingStorage"], {});
  expect(await backend.run((ctx) => ctx.db.system.get(original.storageId))).toBeNull();
  expect(await backend.run((ctx) => ctx.db.system.get(newer.storageId))).not.toBeNull();
  expect(await resolve(backend, original.path)).toMatchObject({ etag: `"${newer.storageId}"` });
});
