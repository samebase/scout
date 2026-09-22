/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const buildMetadata = z.object({
  markerPath: z.string().regex(/^\/__convex_build\/[\da-f-]{36}$/),
});
const deploymentUrls = z.object({ siteUrl: z.url() });

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function getReleaseFile(url: URL) {
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(
      `GET ${url.origin}${url.pathname} returned ${response.status}; ` +
        `cache-control=${response.headers.get("cache-control") ?? "absent"}; ` +
        `request-id=${response.headers.get("x-request-id") ?? response.headers.get("cf-ray") ?? "absent"}`,
    );
  }
  const extension = path.extname(url.pathname);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (
    ((extension === ".js" || extension === ".mjs") &&
      contentType !== "application/javascript" &&
      contentType !== "text/javascript") ||
    (extension === ".css" && contentType !== "text/css")
  ) {
    await response.body?.cancel();
    throw new Error(
      `GET ${url.origin}${url.pathname} returned unexpected content-type ${contentType}.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function verifyStaticRelease(siteUrl: string, distDirectory: string) {
  const metadata = buildMetadata.parse(
    JSON.parse(await readFile(path.join(distDirectory, "server", "client-build.json"), "utf8")),
  );
  const clientDirectory = path.join(distDirectory, "client");
  const markerBody = await readFile(path.join(clientDirectory, metadata.markerPath.slice(1)));
  const markerUrl = new URL(metadata.markerPath, siteUrl);
  const verifyMarker = async () => {
    const serverMetadata = buildMetadata.parse(
      JSON.parse(
        new TextDecoder().decode(await getReleaseFile(new URL("/__convex_build", siteUrl))),
      ),
    );
    if (serverMetadata.markerPath !== metadata.markerPath) {
      throw new Error(
        `Deployed renderer ${serverMetadata.markerPath} does not match ${metadata.markerPath}.`,
      );
    }
    if (digest(await getReleaseFile(markerUrl)) !== digest(markerBody)) {
      throw new Error(`Published build marker does not match ${metadata.markerPath}.`);
    }
  };

  await verifyMarker();
  const assetDirectory = path.join(clientDirectory, "assets");
  const entries = await readdir(assetDirectory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  if (files.length === 0) throw new Error("The client build contains no assets to verify.");

  for (let index = 0; index < files.length; index += 4) {
    const batch = files.slice(index, index + 4);
    await Promise.all(
      batch.map(async (file) => {
        const relativePath = path.relative(clientDirectory, file).split(path.sep).join("/");
        const url = new URL(`/${relativePath}`, siteUrl);
        const [expected, actual] = await Promise.all([readFile(file), getReleaseFile(url)]);
        if (digest(actual) !== digest(expected)) {
          throw new Error(`GET ${url.origin}${url.pathname} does not match the built asset.`);
        }
      }),
    );
  }
  // A different release may have published while its predecessor's assets were checked.
  await verifyMarker();
  console.log(`Verified ${metadata.markerPath} and ${files.length} published assets.`);
}

async function main(args: string[]) {
  const [selector, deployment] = args;
  if (
    !(
      (selector === "--prod" && args.length === 1) ||
      ((selector === "--preview-name" || selector === "--deployment") &&
        args.length === 2 &&
        deployment)
    )
  ) {
    throw new Error(
      "Usage: node ./scripts/verify-static-release.ts <--prod|--preview-name name|--deployment name>",
    );
  }
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url)),
      "run",
      "--component",
      "staticHosting",
      "lib:getUrls",
      "{}",
      ...args,
      "--typecheck=disable",
      "--codegen=disable",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const { siteUrl } = deploymentUrls.parse(JSON.parse(output));
  await verifyStaticRelease(siteUrl, fileURLToPath(new URL("../dist", import.meta.url)));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main(process.argv.slice(2));
}
