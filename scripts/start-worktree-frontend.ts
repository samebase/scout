import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { ensureConvexAuth, runConvexCli } from "./ensure-convex-auth.ts";
import { resolveWorktreeKind } from "./run-context-dev.ts";
import {
  buildWorktreeEnvironment,
  readWorktreeBackend,
  WORKTREE_ACCOUNT,
} from "./run-worktree-dev.ts";

if (resolveWorktreeKind() !== "linked" || process.env["SCOUT_WORKTREE_DEV"] !== "true") {
  throw new Error("Start the worktree with pnpm run dev.");
}

const backend = readWorktreeBackend(parseEnv(readFileSync(".env.local", "utf8")));
const env = {
  ...buildWorktreeEnvironment(process.env),
  CONVEX_DEPLOYMENT: backend.deployment,
  VITE_CONVEX_URL: backend.url,
};
const port = Number(process.env["SCOUT_WORKTREE_PORT"]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("The worktree launcher did not provide a valid frontend port.");
}

console.log(`target: local-anonymous (${backend.deployment}, ${backend.url})`);
await ensureConvexAuth(env);
for (const [name, value] of Object.entries({
  DEV_SEED_AUTH_ENABLED: "true",
  DEV_SEED_AUTH_EMAIL: WORKTREE_ACCOUNT.email,
  DEV_SEED_AUTH_PASSWORD: WORKTREE_ACCOUNT.password,
  SITE_URL: `http://127.0.0.1:${port}`,
})) {
  await runConvexCli(["env", "set", name], { env, input: value, sensitive: true });
}
await runConvexCli(["run", "devAuth:seedPasswordAccount", "{}"], { env });
console.log(`Worktree account ready: ${WORKTREE_ACCOUNT.email}`);

const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("vite-plus/bin")),
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { env, stdio: "inherit" },
);
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
