import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { verifyStaticRelease } from "./verify-static-release.ts";

const markerPath = "/__convex_build/12345678-1234-4123-8123-123456789012";
const metadata = JSON.stringify({ markerPath });
const script = "export const release = 'B';";
const stylesheet = "body { color: red; }";
const responses = new Map<string, { status: number; type: string; body: string }>();
const requested: string[] = [];
let distDirectory: string;
let siteUrl: string;
let afterAsset: (() => void) | undefined;
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  requested.push(pathname);
  const result = responses.get(pathname);
  response.writeHead(result?.status ?? 404, {
    "Content-Type": result?.type ?? "text/plain",
    "Cache-Control": "no-store",
  });
  response.end(result?.body ?? "Not Found");
  if (pathname.startsWith("/assets/")) afterAsset?.();
});

beforeEach(async () => {
  distDirectory = await mkdtemp(path.join(tmpdir(), "scout-release-"));
  await mkdir(path.join(distDirectory, "server"));
  await mkdir(path.join(distDirectory, "client", "assets"), { recursive: true });
  await mkdir(path.join(distDirectory, "client", "__convex_build"));
  await writeFile(path.join(distDirectory, "server", "client-build.json"), metadata);
  await writeFile(path.join(distDirectory, "client", markerPath.slice(1)), metadata);
  await writeFile(path.join(distDirectory, "client", "assets", "app-AbCdEfGh.js"), script);
  await writeFile(path.join(distDirectory, "client", "assets", "style-CprUfdoC.css"), stylesheet);
  responses.clear();
  requested.length = 0;
  afterAsset = undefined;
  responses.set("/__convex_build", { status: 200, type: "application/json", body: metadata });
  responses.set(markerPath, { status: 200, type: "application/octet-stream", body: metadata });
  responses.set("/assets/app-AbCdEfGh.js", {
    status: 200,
    type: "application/javascript; charset=utf-8",
    body: script,
  });
  responses.set("/assets/style-CprUfdoC.css", { status: 200, type: "text/css", body: stylesheet });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP test address");
  siteUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(distDirectory, { recursive: true, force: true });
});

test("verifies real HTTP bytes without requiring renderer initialization or auth", async () => {
  await verifyStaticRelease(siteUrl, distDirectory);
  expect(requested).toContain("/assets/app-AbCdEfGh.js");
  expect(requested).toContain("/assets/style-CprUfdoC.css");
  expect(requested).not.toContain("/");
});

test("rejects a static shell masquerading as the build marker", async () => {
  responses.set(markerPath, { status: 200, type: "text/html", body: "<html>Old shell</html>" });
  await expect(verifyStaticRelease(siteUrl, distDirectory)).rejects.toThrow(
    "build marker does not match",
  );
});

test("rejects a cached missing asset and reports its HTTP status", async () => {
  responses.delete("/assets/app-AbCdEfGh.js");
  await expect(verifyStaticRelease(siteUrl, distDirectory)).rejects.toThrow(
    "app-AbCdEfGh.js returned 404",
  );
});

test.each([
  { type: "text/html", body: script, error: "unexpected content-type text/html" },
  { type: "application/javascript", body: "old build", error: "does not match the built asset" },
])("rejects invalid assets: $error", async ({ type, body, error }) => {
  responses.set("/assets/app-AbCdEfGh.js", { status: 200, type, body });
  await expect(verifyStaticRelease(siteUrl, distDirectory)).rejects.toThrow(error);
});

test("rejects a different deployed renderer even when all browser assets are present", async () => {
  responses.set("/__convex_build", {
    status: 200,
    type: "application/json",
    body: JSON.stringify({ markerPath: "/__convex_build/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  });
  await expect(verifyStaticRelease(siteUrl, distDirectory)).rejects.toThrow("Deployed renderer");
});

test("detects another publication during verification", async () => {
  afterAsset = () => responses.delete(markerPath);
  await expect(verifyStaticRelease(siteUrl, distDirectory)).rejects.toThrow("returned 404");
});
