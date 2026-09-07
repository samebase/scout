import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { readDeploymentEnv, requireWorktreeDeployment } from "./run-worktree-dev.ts";

describe("worktree deployment", () => {
  const primary = { CONVEX_DEPLOYMENT: "dev:primary-123" };

  it("uses an isolated cloud dev deployment", () => {
    expect(requireWorktreeDeployment({ CONVEX_DEPLOYMENT: "dev:worktree-456" }, primary, [])).toBe(
      "dev:worktree-456",
    );
  });

  it.each([undefined, "anonymous:anonymous-agent", "local:local-agent", "prod:production-123"])(
    "rejects an unsupported deployment before starting services: %s",
    (deployment) => {
      expect(() =>
        requireWorktreeDeployment({ CONVEX_DEPLOYMENT: deployment }, primary, []),
      ).toThrow("requires a cloud deployment");
    },
  );

  it("rejects the primary deployment", () => {
    expect(() => requireWorktreeDeployment(primary, primary, [])).toThrow(
      "separate cloud dev deployment",
    );
  });

  it.each(["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"])("rejects %s overrides", (name) => {
    expect(() =>
      requireWorktreeDeployment(
        {
          CONVEX_DEPLOYMENT: "dev:worktree-456",
          [name]: "override",
        },
        primary,
        [],
      ),
    ).toThrow(name);
  });

  it.each([["--prod"], ["--env-file", "other.env"], ["--configure"], ["--once"]])(
    "rejects CLI arguments before starting Convex: %j",
    (...args) => {
      expect(() =>
        requireWorktreeDeployment({ CONVEX_DEPLOYMENT: "dev:worktree-456" }, primary, args),
      ).toThrow("accepts no CLI arguments");
    },
  );

  it.each(["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"])(
    "detects %s in .env while .env.local selects an isolated deployment",
    (key) => {
      const directory = mkdtempSync(path.join(tmpdir(), "scout-worktree-env-"));
      try {
        writeFileSync(path.join(directory, ".env"), `CONVEX_DEPLOYMENT=dev:old\n${key}=override\n`);
        writeFileSync(path.join(directory, ".env.local"), "CONVEX_DEPLOYMENT=dev:worktree-456\n");
        const selected = readDeploymentEnv(directory);
        expect(selected["CONVEX_DEPLOYMENT"]).toBe("dev:worktree-456");
        expect(() => requireWorktreeDeployment(selected, primary, [])).toThrow(key);
      } finally {
        rmSync(directory, { recursive: true });
      }
    },
  );

  it("detects the primary deployment selected in .env", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "scout-primary-env-"));
    try {
      writeFileSync(path.join(directory, ".env"), "CONVEX_DEPLOYMENT=dev:primary-123\n");
      expect(() => requireWorktreeDeployment(primary, readDeploymentEnv(directory), [])).toThrow(
        "separate cloud dev deployment",
      );
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
