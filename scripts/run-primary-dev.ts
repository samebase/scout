// Samebase starter dev launcher sha256:c5838be8323587449fe6129173c4484356a599dbf9dd448d81467d71a3ded86f
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
