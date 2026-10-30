/// <reference types="node" />
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const vitePlusEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));
const ensureConvexAuth = fileURLToPath(new URL("./ensure-convex-auth.ts", import.meta.url));

export function runPrimaryDev() {
  // `convex dev` pushes at once, and a push needs the Convex Auth keys and the hub client.
  execFileSync(process.execPath, [ensureConvexAuth], { stdio: "inherit" });
  execFileSync(process.execPath, [vitePlusEntrypoint, "exec", "pnpm", "run", "hub:client"], {
    stdio: "inherit",
  });
  const child = spawn(
    process.execPath,
    [
      vitePlusEntrypoint,
      "exec",
      "convex",
      "dev",
      ...process.argv.slice(2),
      "--start",
      "vp run dev:frontend",
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
