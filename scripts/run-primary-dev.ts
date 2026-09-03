// Samebase starter dev launcher sha256:41059bcd1300c5d589d2bcbc909c1cbad3c0593b6b3e5e3da6defbec2a688419
/// <reference types="node" />
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const vitePlusEntrypoint = fileURLToPath(import.meta.resolve("vite-plus/bin"));

export function runPrimaryDev() {
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
