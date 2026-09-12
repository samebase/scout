import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const browserPath = process.argv[2];
const artifacts = await mkdtemp(join(tmpdir(), "scout-replay-proof-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  SCOUT_RUN_REPLAY_PROOF: "true",
  SCOUT_REPLAY_PROOF_DIR: artifacts,
};
console.log(`Replay proof artifacts: ${artifacts}`);
if (browserPath) env["SCOUT_REPLAY_PROOF_CHROMIUM"] = browserPath;
const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("vite-plus/bin")),
    "test",
    "src/lib/browserReplayExport.browser.test.ts",
  ],
  { env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
