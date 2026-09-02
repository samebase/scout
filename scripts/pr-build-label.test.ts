import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { computeProjectedBuildNumber } from "./pr-build-label.ts";

const temporaryDirectories: string[] = [];
const validatorPath = fileURLToPath(new URL("./validate-main-build-label.ts", import.meta.url));

function runGit(repository: string, args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(repository: string, subject: string): void {
  runGit(repository, [
    "-c",
    "user.name=Scout Test",
    "-c",
    "user.email=scout@example.invalid",
    "commit",
    "--allow-empty",
    "--quiet",
    "--message",
    subject,
  ]);
}

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), "scout-pr-build-label-"));
  temporaryDirectories.push(repository);
  runGit(repository, ["init", "--quiet", "--initial-branch=main"]);
  return repository;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("projected main build number", () => {
  it("matches the total reachable commit count after a squash commit", () => {
    const repository = createRepository();
    commit(repository, "Initial");
    commit(repository, "Base");
    runGit(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    runGit(repository, ["switch", "--quiet", "--create", "feature"]);
    commit(repository, "Feature one");
    commit(repository, "Feature two");
    commit(repository, "Feature three");

    const projectedBuildNumber = computeProjectedBuildNumber((args) => runGit(repository, args));
    expect(projectedBuildNumber).toBe(3);

    runGit(repository, ["switch", "--quiet", "main"]);
    commit(repository, `v${projectedBuildNumber}: Merge feature`);

    expect(projectedBuildNumber).toBe(Number(runGit(repository, ["rev-list", "--count", "HEAD"])));
    expect(() =>
      execFileSync(process.execPath, [validatorPath], {
        cwd: repository,
        stdio: "pipe",
      }),
    ).not.toThrow();

    runGit(repository, [
      "-c",
      "user.name=Scout Test",
      "-c",
      "user.email=scout@example.invalid",
      "commit",
      "--amend",
      "--allow-empty",
      "--quiet",
      "--message",
      "Missing build label",
    ]);

    expect(() =>
      execFileSync(process.execPath, [validatorPath], {
        cwd: repository,
        stdio: "pipe",
      }),
    ).toThrow();
  });
});
