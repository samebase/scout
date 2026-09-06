import { EventEmitter } from "node:events";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { main, readPreviewOrigin } from "./deploy-cloudflare.ts";

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: childProcess.spawn }));

const upload = {
  type: "version-upload",
  version: 1,
  worker_name: "connected-worker",
  preview_alias_url: "https://feature-connected-worker.example.workers.dev",
};
const session = { type: "wrangler-session", version: 1 };
const env = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "feature",
  WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
  CONVEX_DEPLOY_KEY: "production-key",
  PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
};
let directory: string;
let uploadOutput: string;
let uploadExit: number;
let authExit: number;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "scout-preview-auth-test-"));
  uploadOutput = `${JSON.stringify(session)}\n${JSON.stringify(upload)}\n`;
  uploadExit = 0;
  authExit = 0;
  childProcess.spawn
    .mockReset()
    .mockImplementation((command: string, _args: readonly string[], options: SpawnOptions) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        const outputPath = options.env?.["WRANGLER_OUTPUT_FILE_PATH"];
        const written =
          command === "wrangler" && outputPath
            ? appendFile(outputPath, uploadOutput)
            : Promise.resolve();
        void written.then(
          () => child.emit("close", command === "wrangler" ? uploadExit : authExit),
          (error: unknown) => child.emit("error", error),
        );
      });
      return child;
    });
});
afterEach(async () => {
  await rm(directory, { recursive: true });
});

describe("preview auth deployment", () => {
  it("uses only this upload's alias and preview credentials, while retaining Cloudflare's output", async () => {
    const outputPath = join(directory, "wrangler.json");
    const previous = `${JSON.stringify({ ...upload, preview_alias_url: "https://stale.example.workers.dev" })}\n`;
    await writeFile(outputPath, previous);
    await main(["preview"], { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath });
    expect(childProcess.spawn).toHaveBeenCalledTimes(2);
    expect(childProcess.spawn.mock.calls[0]?.[0]).toBe("wrangler");
    const auth = childProcess.spawn.mock.calls[1];
    expect(auth?.[0]).toBe(process.execPath);
    expect(auth?.[1]).toEqual([
      expect.stringMatching(/[\\/]convex[\\/]bin[\\/]main\.js$/),
      "env",
      "set",
      "SITE_URL",
      upload.preview_alias_url,
      "--preview-name",
      "feature",
    ]);
    expect(auth?.[2]).toMatchObject({ env: { CONVEX_DEPLOY_KEY: "preview-key" } });
    expect(await readFile(outputPath, "utf8")).toBe(previous + uploadOutput);
  });

  it("does not configure auth after a failed upload", async () => {
    uploadExit = 1;
    await expect(
      main(["preview"], { ...env, WRANGLER_OUTPUT_FILE_DIRECTORY: directory }),
    ).rejects.toThrow("failed with exit code 1");
    expect(childProcess.spawn).toHaveBeenCalledTimes(1);
  });

  it("fails the deployment when preview auth setup fails", async () => {
    authExit = 1;
    await expect(
      main(["preview"], { ...env, WRANGLER_OUTPUT_FILE_DIRECTORY: directory }),
    ).rejects.toThrow("failed with exit code 1");
    expect(childProcess.spawn).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete configuration before uploading or changing any environment", async () => {
    await expect(
      main(["preview"], { ...env, PREVIEW_CONVEX_DEPLOY_KEY: undefined }),
    ).rejects.toThrow("PREVIEW_CONVEX_DEPLOY_KEY");
    await expect(main(["preview"], { ...env, WORKERS_CI_BRANCH: undefined })).rejects.toThrow(
      "WORKERS_CI_BRANCH",
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("never changes SITE_URL during a dry-run or production deploy", async () => {
    await main(["preview", "--dry-run"], env);
    await main(["deploy"], { ...env, WORKERS_CI_BRANCH: "main" });
    expect(childProcess.spawn.mock.calls.map((call) => call[0])).toEqual([
      "wrangler",
      "wrangler",
      "vp",
    ]);
  });

  it("rejects missing output instead of reusing a previous deployment's URL", async () => {
    const outputPath = join(directory, "wrangler.json");
    await writeFile(outputPath, uploadOutput);
    uploadOutput = `${JSON.stringify(session)}\n`;
    await expect(
      main(["preview"], { ...env, WRANGLER_OUTPUT_FILE_PATH: outputPath }),
    ).rejects.toThrow("Expected one preview upload");
    expect(childProcess.spawn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...upload, preview_alias_url: null },
    { ...upload, preview_alias_url: "http://feature.example.workers.dev" },
    { ...upload, preview_alias_url: "https://feature.example.workers.dev/settings" },
    { ...upload, preview_alias_url: "https://feature.example.com" },
    { ...upload, worker_name: "another-worker" },
    { ...upload, version: 2 },
  ])("rejects invalid preview metadata: %j", (entry) => {
    expect(() => readPreviewOrigin(JSON.stringify(entry), "connected-worker")).toThrow();
  });
});
