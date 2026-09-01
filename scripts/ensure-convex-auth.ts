/// <reference types="node" />
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONVEX_CLI_PATH = fileURLToPath(
  new URL("../node_modules/convex/bin/main.js", import.meta.url),
);

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunOptions = {
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
  sensitive?: boolean;
  stdio?: "inherit" | "pipe";
};

type RunConvex = (args: string[], options?: RunOptions) => Promise<RunResult>;

type ConvexDeploymentTarget =
  | {
      kind: "selected";
    }
  | {
      kind: "preview";
      previewName: string;
    };

export function buildConvexCliCommand(args: string[], options: RunOptions = {}) {
  const stdio: "inherit" | ["ignore", "pipe", "pipe"] =
    options.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit";

  return {
    command: process.execPath,
    args: [CONVEX_CLI_PATH, ...args],
    spawnOptions: {
      env: options.env ?? process.env,
      stdio,
    },
  };
}

function runConvexCli(args: string[], options: RunOptions = {}) {
  return new Promise<RunResult>((resolve, reject) => {
    const command = buildConvexCliCommand(args, options);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(command.command, command.args, command.spawnOptions);

    if (options.stdio === "pipe") {
      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      };
      if (result.code === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      const commandLabel = options.sensitive ? "convex env set" : `convex ${args.join(" ")}`;
      reject(new Error(`${commandLabel} failed with exit code ${result.code}`));
    });
  });
}

function deploymentSelectorArgs(target: ConvexDeploymentTarget) {
  switch (target.kind) {
    case "selected":
      return [];
    case "preview":
      return ["--preview-name", target.previewName];
    default:
      return target satisfies never;
  }
}

async function readConvexEnv(
  name: string,
  target: ConvexDeploymentTarget,
  env: NodeJS.ProcessEnv,
  runConvex: RunConvex,
) {
  const result = await runConvex(["env", "get", name, ...deploymentSelectorArgs(target)], {
    allowFailure: true,
    env,
    stdio: "pipe",
  });
  if (result.code !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function normalizePrivateKey(privateKey: string | Buffer) {
  return privateKey.toString().trimEnd().replace(/\n/g, " ");
}

function generateAuthKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicJwk = publicKey.export({ format: "jwk" });
  return {
    JWT_PRIVATE_KEY: normalizePrivateKey(privatePem),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] }),
  };
}

async function setConvexEnv(
  name: string,
  value: string,
  target: ConvexDeploymentTarget,
  env: NodeJS.ProcessEnv,
  runConvex: RunConvex,
) {
  await runConvex(["env", "set", ...deploymentSelectorArgs(target), "--", name, value], {
    env,
    sensitive: true,
  });
}

async function seedLocalWorktreePasswordAccount(
  env: NodeJS.ProcessEnv,
  target: ConvexDeploymentTarget,
  runConvex: RunConvex,
) {
  if (env["SCOUT_LOCAL_WORKTREE_AUTH"] !== "true") {
    return;
  }

  const email = env["VITE_LOCAL_WORKTREE_PASSWORD_EMAIL"];
  const password = env["VITE_LOCAL_WORKTREE_PASSWORD_VALUE"];
  if (!email || !password) {
    throw new Error("The local worktree account credentials are missing.");
  }

  await setConvexEnv("DEV_SEED_AUTH_ENABLED", "true", target, env, runConvex);
  await setConvexEnv("DEV_SEED_AUTH_EMAIL", email, target, env, runConvex);
  await setConvexEnv("DEV_SEED_AUTH_PASSWORD", password, target, env, runConvex);
  await runConvex(
    ["run", "devAuth:seedPasswordAccount", "{}", ...deploymentSelectorArgs(target)],
    { env },
  );
  console.log(`Local worktree account ready: ${email}`);
}

export function parseConvexDeploymentTarget(args: readonly string[]): ConvexDeploymentTarget {
  if (args.length === 0) {
    return { kind: "selected" };
  }

  const [flag, previewName, ...extraArgs] = args;
  if (flag !== "--preview-name" || !previewName || extraArgs.length > 0) {
    throw new Error("Usage: node ./scripts/ensure-convex-auth.ts [--preview-name <preview-name>]");
  }

  return { kind: "preview", previewName };
}

export async function ensureConvexAuth(args: {
  env: NodeJS.ProcessEnv;
  runConvex?: RunConvex;
  target: ConvexDeploymentTarget;
}) {
  const runConvex = args.runConvex ?? runConvexCli;
  const existingPrivateKey = await readConvexEnv(
    "JWT_PRIVATE_KEY",
    args.target,
    args.env,
    runConvex,
  );
  const existingJwks = await readConvexEnv("JWKS", args.target, args.env, runConvex);

  if (existingPrivateKey && existingJwks) {
    console.log("Convex Auth keys already configured.");
  } else if (existingPrivateKey || existingJwks) {
    throw new Error("JWT_PRIVATE_KEY and JWKS must be configured together.");
  } else {
    const keys = generateAuthKeys();
    await setConvexEnv("JWT_PRIVATE_KEY", keys.JWT_PRIVATE_KEY, args.target, args.env, runConvex);
    await setConvexEnv("JWKS", keys.JWKS, args.target, args.env, runConvex);
    console.log("Convex Auth keys configured.");
  }

  await seedLocalWorktreePasswordAccount(args.env, args.target, runConvex);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await ensureConvexAuth({
    env: process.env,
    target: parseConvexDeploymentTarget(process.argv.slice(2)),
  });
}
