import { describe, expect, it } from "vite-plus/test";

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

  it("deploys production Convex before the application build", () => {
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
      ["--preview-name", "feature-branch"],
      ["exec", "convex", "run", "devAuth:seedPasswordAccount", "--preview-name", "feature-branch"],
    ]);
  });
});
