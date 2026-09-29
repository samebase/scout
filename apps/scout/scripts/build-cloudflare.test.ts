import { describe, expect, it } from "vite-plus/test";
import { basename } from "node:path";

import { main, selectCloudflareBuildPlan } from "./build-cloudflare.ts";

describe("build-cloudflare", () => {
  it("runs only the application build outside Workers Builds", () => {
    expect(
      selectCloudflareBuildPlan({
        CONVEX_DEPLOY_KEY: "ignored-local-key",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toEqual({
      kind: "app",
      buildArgs: ["run", "build:app"],
    });
  });

  it("requires the branch during Workers Builds", () => {
    expect(() =>
      selectCloudflareBuildPlan({
        CONVEX_DEPLOY_KEY: "production-key",
        WORKERS_CI: "1",
      }),
    ).toThrow("WORKERS_CI_BRANCH");
  });

  it("does not accept the legacy key during Workers Builds", () => {
    expect(() =>
      selectCloudflareBuildPlan({
        PREVIEW_CONVEX_DEPLOY_KEY: "legacy-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toThrow("Set CONVEX_DEPLOY_KEY");
  });

  it("requires the least-privilege production key", () => {
    expect(() =>
      selectCloudflareBuildPlan({
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toThrow(
      "deployment:deploy, deployment:env:view, deployment:env:write, and deployment:data:view",
    );
  });

  it("selects production Convex and verifies its published frontend", () => {
    expect(
      selectCloudflareBuildPlan({
        CONVEX_DEPLOY_KEY: "production-key",
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toEqual({
      kind: "production",
      deployArgs: [
        "exec",
        "convex",
        "deploy",
        "--cmd",
        "pnpm run build:app && node ./scripts/verify-current-branch-head.ts",
      ],
      authArgs: [],
      uploadArgs: ["exec", "static-hosting", "upload", "--dist", "./dist/client", "--prod"],
      verifyArgs: ["--prod"],
    });
  });

  it("uses the branch name for the Convex Preview, auth setup, and seed", () => {
    expect(
      selectCloudflareBuildPlan({
        CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toEqual({
      kind: "preview",
      previewName: "feature-branch",
      deployArgs: [
        "exec",
        "convex",
        "deploy",
        "--preview-name",
        "feature-branch",
        "--cmd",
        "pnpm run build:app && node ./scripts/verify-current-branch-head.ts",
      ],
      authArgs: ["--preview-name", "feature-branch"],
      seedArgs: [
        "exec",
        "convex",
        "run",
        "devAuth:seedPasswordAccount",
        "--preview-name",
        "feature-branch",
      ],
      uploadArgs: [
        "exec",
        "static-hosting",
        "upload",
        "--dist",
        "./dist/client",
        "--preview-name",
        "feature-branch",
      ],
      verifyArgs: ["--preview-name", "feature-branch"],
    });
  });

  it("seeds only after the Preview deploy and auth setup succeed", async () => {
    const invocations: string[][] = [];

    await main(
      {
        CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature-branch",
      },
      async (_entrypoint, args) => {
        invocations.push([...args]);
      },
    );

    expect(invocations).toEqual([
      [
        "exec",
        "convex",
        "deploy",
        "--preview-name",
        "feature-branch",
        "--cmd",
        "pnpm run build:app && node ./scripts/verify-current-branch-head.ts",
      ],
      [],
      [
        "exec",
        "static-hosting",
        "upload",
        "--dist",
        "./dist/client",
        "--preview-name",
        "feature-branch",
      ],
      ["--preview-name", "feature-branch"],
      ["--preview-name", "feature-branch"],
      ["exec", "convex", "run", "devAuth:seedPasswordAccount", "--preview-name", "feature-branch"],
    ]);
  });

  it("publishes and verifies production assets before auth setup", async () => {
    const invocations: string[] = [];
    await main(
      { CONVEX_DEPLOY_KEY: "production-key", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" },
      async (entrypoint, args) => {
        invocations.push(args[0] === "exec" ? args[2] : basename(entrypoint));
      },
    );
    expect(invocations).toEqual([
      "deploy",
      "verify-current-branch-head.ts",
      "upload",
      "verify-static-release.ts",
      "ensure-convex-auth.ts",
    ]);
  });

  it.each(["deploy", "upload", "verify-static-release.ts"])(
    "stops the build before auth setup and seed when %s fails",
    async (failedStep) => {
      const invocations: string[] = [];
      await expect(
        main(
          { CONVEX_DEPLOY_KEY: "preview-key", WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature" },
          async (entrypoint, args) => {
            const step = args[0] === "exec" ? args[2] : basename(entrypoint);
            invocations.push(step);
            if (step === failedStep) {
              throw new Error("release failed");
            }
          },
        ),
      ).rejects.toThrow("release failed");
      expect(invocations).not.toContain("ensure-convex-auth.ts");
      expect(invocations).not.toContain("run");
      expect(invocations.at(-1)).toBe(failedStep);
    },
  );
});
