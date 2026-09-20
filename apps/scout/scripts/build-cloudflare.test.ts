import { describe, expect, it } from "vite-plus/test";

import { main, selectConvexDeployPlan } from "./build-cloudflare.ts";

describe("build-cloudflare", () => {
  it("requires the preview key for non-main branches with the production key present", () => {
    expect(() =>
      selectConvexDeployPlan({
        CONVEX_DEPLOY_KEY: "prod-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toThrow("Use a Convex project Preview deploy key.");
  });

  it("requires the Workers branch during Workers builds", () => {
    expect(() =>
      selectConvexDeployPlan({
        WORKERS_CI: "1",
      }),
    ).toThrow("Set WORKERS_CI_BRANCH");
  });

  it("selects the production key for the main branch", () => {
    expect(
      selectConvexDeployPlan({
        CONVEX_DEPLOY_KEY: "prod-key",
        PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toEqual({
      kind: "deploy",
      deployKeyName: "CONVEX_DEPLOY_KEY",
      deployKey: "prod-key",
      args: [
        "exec",
        "convex",
        "deploy",
        "--cmd",
        "vp run build:app && node ./scripts/verify-current-branch-head.ts",
      ],
    });
  });

  it("seeds after a successful preview deploy and auth setup", async () => {
    const invocations: string[] = [];
    const runCommand = (_command: string, args: readonly string[]) => {
      invocations.push(args[2] === "run" ? (args[3] ?? "run") : (args[2] ?? "build"));
      return Promise.resolve();
    };
    const ensureAuth = () => {
      invocations.push("ensureAuth");
      return Promise.resolve();
    };

    await main(
      {
        PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature-branch",
      },
      runCommand,
      ensureAuth,
    );

    expect(invocations).toEqual(["deploy", "ensureAuth", "devAuth:seedPasswordAccount", "upload"]);
  });

  it("does not seed when the preview deploy fails", async () => {
    const invocations: string[] = [];
    const runCommand = (_command: string, args: readonly string[]) => {
      invocations.push(args[2] ?? "build");
      return Promise.reject(new Error("deploy failed"));
    };
    const ensureAuth = () => {
      invocations.push("ensureAuth");
      return Promise.resolve();
    };

    await expect(
      main(
        {
          PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
          WORKERS_CI: "1",
          WORKERS_CI_BRANCH: "feature-branch",
        },
        runCommand,
        ensureAuth,
      ),
    ).rejects.toThrow("deploy failed");

    expect(invocations).toEqual(["deploy"]);
  });

  it("does not seed production after auth setup", async () => {
    const invocations: string[] = [];
    const runCommand = (_command: string, args: readonly string[]) => {
      invocations.push(args[2] ?? "build");
      return Promise.resolve();
    };
    const ensureAuth = () => {
      invocations.push("ensureAuth");
      return Promise.resolve();
    };

    await main(
      {
        CONVEX_DEPLOY_KEY: "production-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
      },
      runCommand,
      ensureAuth,
    );

    expect(invocations).toEqual(["deploy", "ensureAuth"]);
  });

  it("selects the preview key for non-main branches", () => {
    expect(
      selectConvexDeployPlan({
        CONVEX_DEPLOY_KEY: "prod-key",
        PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toEqual({
      kind: "previewDeploy",
      deployKeyName: "PREVIEW_CONVEX_DEPLOY_KEY",
      deployKey: "preview-key",
      args: [
        "exec",
        "convex",
        "deploy",
        "--preview-name",
        "feature-branch",
        "--cmd",
        "vp run build:app && node ./scripts/verify-current-branch-head.ts",
      ],
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
    });
  });

  it("requires the production key with the current least-privilege permission set", () => {
    expect(() =>
      selectConvexDeployPlan({
        PREVIEW_CONVEX_DEPLOY_KEY: "preview-key",
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toThrow(
      "Use a Convex production deploy key with exactly deployment:deploy, deployment:env:view, deployment:env:write, and deployment:data:view.",
    );
  });

  it("skips Convex deploys for local builds without deploy keys", () => {
    expect(selectConvexDeployPlan({})).toEqual({ kind: "frontendOnly" });
  });

  it("requires an explicit branch when Convex deploy keys are present locally", () => {
    expect(() =>
      selectConvexDeployPlan({
        CONVEX_DEPLOY_KEY: "prod-key",
      }),
    ).toThrow("Set WORKERS_CI_BRANCH");
  });
});
