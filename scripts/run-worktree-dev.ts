// Samebase starter dev launcher sha256:183d51d3d085b9ec8455601e19b62fc55aa2bdcf520d2cd72d1422b3114ce134
/// <reference types="node" />
import process from "node:process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { resolveWorktreeKind } from "./run-context-dev.ts";

export const WORKTREE_ACCOUNT = {
  email: "worktree@scout.test",
  password: "scout-worktree-password",
};

export function buildWorktreeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    CONVEX_AGENT_MODE: "anonymous",
    // Empty values prevent Convex's dotenv loader from restoring copied cloud credentials.
    CONVEX_DEPLOY_KEY: "",
    CONVEX_DEPLOYMENT_TOKEN: "",
    CONVEX_DEPLOYMENT: "",
    CONVEX_SELF_HOSTED_URL: "",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    CONVEX_OVERRIDE_ACCESS_TOKEN: "",
    SCOUT_WORKTREE_DEV: "true",
    SCOUT_WORKTREE_PORT: "",
  };
}

export function readWorktreeBackend(env: NodeJS.ProcessEnv) {
  const deployment = env["CONVEX_DEPLOYMENT"];
  const url = env["VITE_CONVEX_URL"];
  if (!deployment?.startsWith("anonymous:") || !url || !isLoopbackUrl(url)) {
    throw new Error("Expected this worktree's anonymous Convex deployment and loopback URL.");
  }
  return { deployment, url };
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function worktreeAuthDefine({
  command,
  mode,
  linked,
  env,
}: {
  command: string;
  mode: string;
  linked: boolean;
  env: NodeJS.ProcessEnv;
}) {
  const enabled =
    command === "serve" &&
    mode === "development" &&
    linked &&
    env["SCOUT_WORKTREE_DEV"] === "true" &&
    isLoopbackUrl(env["VITE_CONVEX_URL"] ?? "");
  return {
    "import.meta.env.VITE_WORKTREE_AUTH_EMAIL": JSON.stringify(
      enabled ? WORKTREE_ACCOUNT.email : "",
    ),
    "import.meta.env.VITE_WORKTREE_AUTH_PASSWORD": JSON.stringify(
      enabled ? WORKTREE_ACCOUNT.password : "",
    ),
  };
}

export function preferredWorktreePort(worktreePath: string) {
  return 5200 + (createHash("sha256").update(worktreePath).digest().readUInt32BE(0) % 10000);
}

export function runWorktreeDev() {
  if (resolveWorktreeKind() !== "linked") {
    throw new Error("Worktree development requires a linked Git worktree. Use pnpm run dev here.");
  }
  const env = buildWorktreeEnvironment(process.env);
  env["SCOUT_WORKTREE_PORT"] = String(preferredWorktreePort(process.cwd()));
  console.log("target: local-anonymous (this worktree's isolated Convex database)");
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url)),
      "dev",
      "--start",
      "node ./scripts/start-worktree-frontend.ts",
    ],
    { env, stdio: ["ignore", "inherit", "inherit"] },
  );
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill("SIGINT"));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runWorktreeDev();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
