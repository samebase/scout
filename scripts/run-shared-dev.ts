import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

export const sharedDevEnvironment = z
  .object({
    CONVEX_DEPLOYMENT: z
      .string()
      .regex(/^dev:[a-z0-9-]+$/, "Select a cloud development deployment"),
    VITE_CONVEX_URL: z.url(),
  })
  .refine(
    (environment) => {
      const deploymentName = environment.CONVEX_DEPLOYMENT.slice("dev:".length);
      return new RegExp(`^https://${deploymentName}(?:\\.[a-z0-9-]+)?\\.convex\\.cloud/?$`).test(
        environment.VITE_CONVEX_URL,
      );
    },
    { message: "The Convex URL must match the selected development deployment" },
  );

function main() {
  const commonGitDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  const primaryEnvironmentPath = path.join(path.dirname(commonGitDirectory), ".env.local");
  const environment = sharedDevEnvironment.parse(
    parseEnv(readFileSync(primaryEnvironmentPath, "utf8")),
  );

  console.log(`Frontend using ${environment.CONVEX_DEPLOYMENT} (${environment.VITE_CONVEX_URL}).`);
  console.log("Test chats and Scout actions use the shared development database.");

  const frontendEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_CONVEX_URL: environment.VITE_CONVEX_URL,
  };
  // The isolated worktree's seeded login belongs to a different database.
  delete frontendEnvironment["VITE_LOCAL_WORKTREE_PASSWORD_EMAIL"];
  delete frontendEnvironment["VITE_LOCAL_WORKTREE_PASSWORD_VALUE"];

  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.resolve("vite-plus/bin")), "dev", ...process.argv.slice(2)],
    { env: frontendEnvironment, stdio: "inherit" },
  );
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
