/// <reference types="node" />
import process from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

import { runPrimaryDev } from "./run-primary-dev.ts";

export function readDeploymentEnv(directory: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(directory, name);
    if (existsSync(file)) Object.assign(env, parse(readFileSync(file, "utf8")));
  }
  return env;
}

export function requireWorktreeDeployment(
  selected: NodeJS.ProcessEnv,
  primary: NodeJS.ProcessEnv,
  args: string[],
) {
  if (args.length) {
    throw new Error(
      "Worktree dev uses the selected deployment and accepts no CLI arguments. " +
        "Run pnpm exec convex separately to configure a deployment.",
    );
  }
  const deployment = selected["CONVEX_DEPLOYMENT"];
  if (
    !deployment?.startsWith("dev:") ||
    selected["CONVEX_DEPLOY_KEY"] ||
    selected["CONVEX_DEPLOYMENT_TOKEN"]
  ) {
    throw new Error(
      "Scout uses Convex AI Gateway, which requires a cloud deployment. " +
        "Create a dev deployment for this worktree with: " +
        "pnpm exec convex deployment create <team>:<project>:dev/<feature> --type dev --select. " +
        "Remove any CONVEX_DEPLOY_KEY or CONVEX_DEPLOYMENT_TOKEN override before running dev.",
    );
  }
  if (deployment === primary["CONVEX_DEPLOYMENT"]) {
    throw new Error(
      "Select a separate cloud dev deployment for this worktree, not the primary checkout's deployment.",
    );
  }
  return deployment;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commonGitDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  const deployment = requireWorktreeDeployment(
    { ...readDeploymentEnv(process.cwd()), ...process.env },
    readDeploymentEnv(path.dirname(commonGitDirectory)),
    process.argv.slice(2),
  );
  process.env["CONVEX_DEPLOYMENT"] = deployment;
  delete process.env["CONVEX_AGENT_MODE"];
  runPrimaryDev();
}
