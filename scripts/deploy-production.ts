/// <reference types="node" />
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const wranglerEntrypoint = fileURLToPath(
  new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")),
);
const staticHostingEntrypoint = fileURLToPath(
  new URL("./dist/cli/index.js", import.meta.resolve("@convex-dev/static-hosting/package.json")),
);

type RunNode = (
  entrypoint: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

function runNode(entrypoint: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${entrypoint} exited with signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${entrypoint} failed with exit code ${code ?? 1}`));
    });
  });
}

export function selectProductionDeployPlan(env: NodeJS.ProcessEnv) {
  const isWorkersBuild = env["WORKERS_CI"] === "1" || env["WORKERS_CI"] === "true";
  return {
    wranglerArgs: ["deploy"],
    staticHostingArgs:
      isWorkersBuild && env["WORKERS_CI_BRANCH"] === "main"
        ? ["upload", "--dist", "./dist/client", "--prod"]
        : null,
  };
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  runNodeCommand: RunNode = runNode,
) {
  const plan = selectProductionDeployPlan(env);

  await runNodeCommand(wranglerEntrypoint, plan.wranglerArgs, env);
  if (plan.staticHostingArgs) {
    await runNodeCommand(staticHostingEntrypoint, plan.staticHostingArgs, env);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
