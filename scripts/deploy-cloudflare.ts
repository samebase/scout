/// <reference types="node" />
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const modes = {
  deploy: ["deploy"],
  preview: ["versions", "upload"],
} as const;

type Mode = keyof typeof modes;

function isMode(value: string | undefined): value is Mode {
  return value === "deploy" || value === "preview";
}

function isReservedWranglerFlag(value: string) {
  return value === "--name" || value.startsWith("--name=") || value === "-n";
}

function isDryRunFlag(value: string) {
  return value === "--dry-run" || value === "--dry-run=true";
}

function readWorkerName(env: NodeJS.ProcessEnv) {
  const workerName = env["WRANGLER_CI_OVERRIDE_NAME"] ?? env["CLOUDFLARE_WORKER_NAME"];

  if (!workerName) {
    throw new Error(
      [
        "Missing Cloudflare Worker name.",
        "Workers Builds provides WRANGLER_CI_OVERRIDE_NAME automatically.",
        "For local deploy checks, set CLOUDFLARE_WORKER_NAME.",
      ].join("\n"),
    );
  }

  if (!/^[a-zA-Z0-9-]+$/.test(workerName)) {
    throw new Error("Cloudflare Worker names can only contain letters, numbers, and dashes.");
  }

  return workerName;
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: process.platform === "win32" && command !== process.execPath,
      stdio: "inherit",
      env,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

type CloudflareDeployPlan = {
  buildArgs: readonly string[] | null;
  convexStaticHostingArgs: readonly string[] | null;
  wranglerArgs: readonly string[];
  previewAuth: { previewName: string; deployKey: string; workerName: string } | null;
};

export function selectCloudflareDeployPlan(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): CloudflareDeployPlan {
  const [modeArg, ...extraArgs] = args;

  if (!isMode(modeArg)) {
    throw new Error("Usage: node ./scripts/deploy-cloudflare.ts <deploy|preview> [wrangler flags]");
  }

  if (extraArgs.some(isReservedWranglerFlag)) {
    throw new Error(
      "Do not pass Wrangler --name/-n manually. Set CLOUDFLARE_WORKER_NAME or let Workers Builds provide WRANGLER_CI_OVERRIDE_NAME.",
    );
  }

  if (extraArgs.includes("--")) {
    throw new Error(
      "Do not pass a standalone -- to Wrangler. Pass Wrangler flags directly after the deploy command.",
    );
  }

  const workerName = readWorkerName(env);
  const isWorkersBuild = env["WORKERS_CI"] === "1" || env["WORKERS_CI"] === "true";
  const isDryRun = extraArgs.some(isDryRunFlag);
  const uploadsConvexSite =
    isWorkersBuild && modeArg === "deploy" && env["WORKERS_CI_BRANCH"] === "main" && !isDryRun;
  let previewAuth: CloudflareDeployPlan["previewAuth"] = null;
  if (isWorkersBuild && modeArg === "preview" && !isDryRun) {
    const previewName = env["WORKERS_CI_BRANCH"];
    if (!previewName) throw new Error("WORKERS_CI_BRANCH is required for preview auth setup.");
    if (previewName !== "main") {
      const deployKey = env["PREVIEW_CONVEX_DEPLOY_KEY"];
      if (!deployKey)
        throw new Error("PREVIEW_CONVEX_DEPLOY_KEY is required for preview auth setup.");
      previewAuth = { previewName, deployKey, workerName };
    }
  }

  return {
    buildArgs: isWorkersBuild ? null : ["run", isDryRun ? "build:app" : "build:cloudflare"],
    convexStaticHostingArgs: uploadsConvexSite
      ? ["exec", "static-hosting", "upload", "--dist", "./dist/client", "--prod"]
      : null,
    wranglerArgs: [...modes[modeArg], "--name", workerName, ...extraArgs],
    previewAuth,
  };
}

// Wrangler 4 emits these version-1 records to WRANGLER_OUTPUT_FILE_PATH during versions upload.
const previewOutputEntry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wrangler-session"), version: z.literal(1) }),
  z.object({
    type: z.literal("version-upload"),
    version: z.literal(1),
    worker_name: z.string(),
    preview_alias_url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" && url.origin === value && url.hostname.endsWith(".workers.dev")
      );
    }, "Expected a Cloudflare branch preview origin"),
  }),
]);

export function readPreviewOrigin(output: string, workerName: string) {
  const uploads = output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const value: unknown = JSON.parse(line);
      return previewOutputEntry.parse(value);
    })
    .filter((entry) => entry.type === "version-upload");
  if (uploads.length !== 1 || uploads[0].worker_name !== workerName)
    throw new Error("Expected one preview upload for the connected Worker.");
  return uploads[0].preview_alias_url;
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
) {
  const plan = selectCloudflareDeployPlan(args, env);

  if (plan.buildArgs) {
    await run("vp", plan.buildArgs, env);
  }

  if (plan.previewAuth) {
    const temporaryOutput =
      !env["WRANGLER_OUTPUT_FILE_PATH"] && !env["WRANGLER_OUTPUT_FILE_DIRECTORY"];
    const outputPath =
      env["WRANGLER_OUTPUT_FILE_PATH"] ??
      join(
        env["WRANGLER_OUTPUT_FILE_DIRECTORY"] ?? tmpdir(),
        `wrangler-output-scout-${randomUUID()}.json`,
      );
    await mkdir(dirname(outputPath), { recursive: true });
    const output = await open(outputPath, "a+");
    try {
      const { size: previousBytes } = await output.stat();
      await run("wrangler", plan.wranglerArgs, { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath });
      const newOutput = (await output.readFile()).subarray(previousBytes).toString("utf8");
      const origin = readPreviewOrigin(newOutput, plan.previewAuth.workerName);
      console.log(`Configuring SITE_URL for preview ${plan.previewAuth.previewName}: ${origin}`);
      await run(
        process.execPath,
        [
          fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url)),
          "env",
          "set",
          "SITE_URL",
          origin,
          "--preview-name",
          plan.previewAuth.previewName,
        ],
        { ...env, CONVEX_DEPLOY_KEY: plan.previewAuth.deployKey },
      );
    } finally {
      await output.close();
      if (temporaryOutput) await rm(outputPath);
    }
  } else {
    await run("wrangler", plan.wranglerArgs, env);
  }

  if (plan.convexStaticHostingArgs) {
    await run("vp", plan.convexStaticHostingArgs, env);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
