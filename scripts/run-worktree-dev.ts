// Samebase starter dev launcher sha256:c5838be8323587449fe6129173c4484356a599dbf9dd448d81467d71a3ded86f
/// <reference types="node" />
import process from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { runPrimaryDev } from "./run-primary-dev.ts";

function readDeploymentEnv(directory: string) {
  const file = path.join(directory, ".env.local");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

export function requireWorktreeDeployment(selected: NodeJS.ProcessEnv, primary: NodeJS.ProcessEnv) {
  const deployment = selected["CONVEX_DEPLOYMENT"];
  if (!deployment?.startsWith("dev:") || selected["CONVEX_DEPLOY_KEY"]) {
    throw new Error(
      "Scout uses Convex AI Gateway, which requires a cloud deployment. " +
        "Create a dev deployment for this worktree with: " +
        "pnpm exec convex deployment create <team>:<project>:dev/<feature> --type dev --select. " +
        "Remove any CONVEX_DEPLOY_KEY override before running dev.",
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
  );
  process.env["CONVEX_DEPLOYMENT"] = deployment;
  delete process.env["CONVEX_AGENT_MODE"];
  process.env["SCOUT_LOCAL_WORKTREE_AUTH"] = "true";
  process.env["VITE_LOCAL_WORKTREE_PASSWORD_EMAIL"] = "nicu.dev@gmail.com";
  process.env["VITE_LOCAL_WORKTREE_PASSWORD_VALUE"] = "pass1234";
  runPrimaryDev();
}
