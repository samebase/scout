/// <reference types="node" />
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const vitePlusEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));

export function runPrimaryDev() {
  // HTTP actions import the generated server, so it must exist before Convex starts.
  const build = spawnSync(process.execPath, [vitePlusEntrypoint, "run", "build:app"], {
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
  const child = spawn(
    process.execPath,
    [
      vitePlusEntrypoint,
      "exec",
      "convex",
      "dev",
      ...process.argv.slice(2),
      "--start",
      "node ./scripts/ensure-convex-auth.ts && vp run dev:frontend",
    ],
    {
      stdio: "inherit",
    },
  );

  child.on("error", (error) => {
    console.error(`Failed to start dev mode: ${error.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code ?? 1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPrimaryDev();
}
