import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { resolveWorktreeKind, selectDevRunner } from "./run-context-dev.ts";

describe("run-context-dev", () => {
  it("selects the primary runner for the main Git worktree", () => {
    expect(selectDevRunner("main")).toBe("run-primary-dev.ts");
  });

  it("selects the worktree runner for a linked Git worktree", () => {
    expect(selectDevRunner("linked")).toBe("run-worktree-dev.ts");
  });

  it("detects nested app worktrees and rejects sharing the primary deployment", () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "samebase-app-run-dev-test-"));
    const mainWorktree = path.join(temporaryDirectory, "main");
    const linkedWorktree = path.join(temporaryDirectory, "linked");

    try {
      execFileSync("git", ["init", "--initial-branch=main", mainWorktree], { stdio: "pipe" });
      execFileSync(
        "git",
        [
          "-C",
          mainWorktree,
          "-c",
          "user.name=Samebase test",
          "-c",
          "user.email=test@samebase.com",
          "commit",
          "--allow-empty",
          "-m",
          "Initial commit",
        ],
        { stdio: "pipe" },
      );
      execFileSync("git", ["-C", mainWorktree, "worktree", "add", "--detach", linkedWorktree], {
        stdio: "pipe",
      });

      expect(resolveWorktreeKind(mainWorktree)).toBe("main");
      expect(resolveWorktreeKind(linkedWorktree)).toBe("linked");

      const mainApp = path.join(mainWorktree, "apps", "scout");
      const linkedApp = path.join(linkedWorktree, "apps", "scout");
      mkdirSync(mainApp, { recursive: true });
      mkdirSync(linkedApp, { recursive: true });
      writeFileSync(path.join(mainApp, ".env.local"), "CONVEX_DEPLOYMENT=dev:primary-123\n");
      expect(resolveWorktreeKind(mainApp)).toBe("main");
      expect(resolveWorktreeKind(linkedApp)).toBe("linked");
      expect(() =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL("./run-worktree-dev.ts", import.meta.url))],
          {
            cwd: linkedApp,
            env: {
              ...process.env,
              CONVEX_DEPLOYMENT: "dev:primary-123",
              CONVEX_DEPLOY_KEY: "",
              CONVEX_DEPLOYMENT_TOKEN: "",
            },
            stdio: "pipe",
            timeout: 5_000,
          },
        ),
      ).toThrow("separate cloud dev deployment");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
