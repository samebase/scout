import process from "node:process";

import { describe, expect, it } from "vite-plus/test";

import {
  buildConvexCliCommand,
  ensureConvexAuth,
  parseConvexDeploymentTarget,
} from "./ensure-convex-auth.ts";

describe("ensure-convex-auth", () => {
  it("runs the Convex JavaScript entrypoint through Node without a shell", () => {
    const command = buildConvexCliCommand(["env", "get", "JWKS"], {
      env: {},
      stdio: "pipe",
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args[0]).toMatch(/[\\/]node_modules[\\/]convex[\\/]bin[\\/]main\.js$/);
    expect(command.args.slice(1)).toEqual(["env", "get", "JWKS"]);
    expect(command.spawnOptions).not.toHaveProperty("shell");
  });

  it("sets both auth keys when direct Convex reads return empty values", async () => {
    const calls: string[][] = [];

    await ensureConvexAuth({
      env: {},
      target: { kind: "selected" },
      runConvex: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls.slice(0, 2)).toEqual([
      ["env", "get", "JWT_PRIVATE_KEY"],
      ["env", "get", "JWKS"],
    ]);
    expect(calls.slice(2).map((args) => args.slice(0, 4))).toEqual([
      ["env", "set", "--", "JWT_PRIVATE_KEY"],
      ["env", "set", "--", "JWKS"],
    ]);
    expect(calls[2]?.[4]).toBeTruthy();
    expect(calls[3]?.[4]).toBeTruthy();
  });
  it("seeds the password account only for local worktree development", async () => {
    const calls: string[][] = [];

    await ensureConvexAuth({
      env: {
        SCOUT_LOCAL_WORKTREE_AUTH: "true",
        VITE_LOCAL_WORKTREE_PASSWORD_EMAIL: "nicu.dev@gmail.com",
        VITE_LOCAL_WORKTREE_PASSWORD_VALUE: "pass1234",
      },
      target: { kind: "selected" },
      runConvex: async (args) => {
        calls.push(args);
        return {
          code: 0,
          stdout: args[1] === "get" ? "configured" : "",
          stderr: "",
        };
      },
    });

    expect(calls).toEqual([
      ["env", "get", "JWT_PRIVATE_KEY"],
      ["env", "get", "JWKS"],
      ["env", "set", "--", "DEV_SEED_AUTH_ENABLED", "true"],
      ["env", "set", "--", "DEV_SEED_AUTH_EMAIL", "nicu.dev@gmail.com"],
      ["env", "set", "--", "DEV_SEED_AUTH_PASSWORD", "pass1234"],
      ["run", "devAuth:seedPasswordAccount", "{}"],
    ]);
  });

  it("targets every auth operation at the named Preview", async () => {
    const calls: string[][] = [];

    await ensureConvexAuth({
      env: {},
      target: parseConvexDeploymentTarget(["--preview-name", "feature-branch"]),
      runConvex: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls.slice(0, 2)).toEqual([
      ["env", "get", "JWT_PRIVATE_KEY", "--preview-name", "feature-branch"],
      ["env", "get", "JWKS", "--preview-name", "feature-branch"],
    ]);
    expect(calls[2]?.slice(0, 6)).toEqual([
      "env",
      "set",
      "--preview-name",
      "feature-branch",
      "--",
      "JWT_PRIVATE_KEY",
    ]);
    expect(calls[3]?.slice(0, 6)).toEqual([
      "env",
      "set",
      "--preview-name",
      "feature-branch",
      "--",
      "JWKS",
    ]);
    expect(calls[2]?.[6]).toBeTruthy();
    expect(calls[3]?.[6]).toBeTruthy();
  });

  it("rejects unsupported command arguments", () => {
    expect(() => parseConvexDeploymentTarget(["--prod"])).toThrow("Usage:");
  });
});
