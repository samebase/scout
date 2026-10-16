/// <reference types="node" />
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function verifyCurrentBranchHead(
  env: NodeJS.ProcessEnv,
  // samebase/scout is public, so `git ls-remote` needs no credentials after `actions/checkout`
  // with `persist-credentials: false`.
  readRemoteHead = (branch: string) => {
    const output = execFileSync(
      "git",
      ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`],
      { encoding: "utf8" },
    );
    const [remoteHead] = output.trim().split(/\s+/, 1);
    return remoteHead;
  },
  readCheckoutHead = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
) {
  if (env["GITHUB_ACTIONS"] !== "true") {
    return;
  }

  // A pull request run names its branch in GITHUB_HEAD_REF; a push to main leaves it empty.
  const branch = env["GITHUB_HEAD_REF"] || env["GITHUB_REF_NAME"];

  if (!branch) {
    throw new Error(
      "GitHub Actions must provide GITHUB_HEAD_REF or GITHUB_REF_NAME before Convex deploys.",
    );
  }

  const checkoutHead = readCheckoutHead();
  const remoteHead = readRemoteHead(branch);

  if (remoteHead !== checkoutHead) {
    throw new Error(
      `${checkoutHead} is stale: ${branch} now points to ${remoteHead}. Refusing to deploy this stale build.`,
    );
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  verifyCurrentBranchHead(process.env);
}
