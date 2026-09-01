/// <reference types="node" />
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const wranglerEntrypoint = fileURLToPath(
  new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")),
);

function readWorkerName(env: NodeJS.ProcessEnv) {
  const workerName = env["WRANGLER_CI_OVERRIDE_NAME"] ?? env["CLOUDFLARE_WORKER_NAME"];
  if (!workerName) {
    throw new Error(
      "Missing Worker name. Workers Builds provides WRANGLER_CI_OVERRIDE_NAME. Set CLOUDFLARE_WORKER_NAME for a local Preview deploy.",
    );
  }
  return workerName;
}

export function selectWorkerPreviewArgs(env: NodeJS.ProcessEnv) {
  return ["preview", "--worker-name", readWorkerName(env)];
}

export async function main(env: NodeJS.ProcessEnv = process.env) {
  const args = selectWorkerPreviewArgs(env);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerEntrypoint, ...args], {
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`wrangler preview exited with signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler preview failed with exit code ${code ?? 1}`));
    });
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
