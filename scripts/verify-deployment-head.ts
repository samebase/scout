import { execFileSync } from "node:child_process";

const repository = process.env["GITHUB_REPOSITORY"];
const branch = process.env["GITHUB_HEAD_REF"] || process.env["GITHUB_REF_NAME"];
const token = process.env["GITHUB_TOKEN"];
if (!repository || !branch || !token) {
  throw new Error("The deployment head check requires the GitHub repository, branch, and token.");
}

const response = await fetch(
  `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`,
  {
    headers: { Accept: "application/vnd.github.sha", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok) {
  throw new Error(`Cannot read the head of ${branch}: GitHub returned HTTP ${response.status}.`);
}
const head = (await response.text()).trim();
if (!/^[a-f0-9]{40}$/.test(head)) {
  throw new Error(`GitHub did not return a commit SHA for ${branch}.`);
}
const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (checkout !== head) {
  throw new Error(`The checkout is not the head of ${branch} (${head}). Nothing was deployed.`);
}
