// Samebase starter dev launcher sha256:704cdd4ab69672fa6befc1aa2ddc698312a164224b0d03d056231f9c2bcd690f
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
