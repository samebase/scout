import { describe, expect, it } from "vite-plus/test";

import { selectCloudflareDeployPlan } from "./deploy-cloudflare.ts";

describe("deploy-cloudflare", () => {
  it("uses the application-only build for a local dry-run", () => {
    expect(
      selectCloudflareDeployPlan(["deploy", "--dry-run"], {
        CLOUDFLARE_WORKER_NAME: "example-app",
      }),
    ).toEqual({
      buildArgs: ["run", "build:app"],
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["deploy", "--name", "example-app", "--dry-run"],
    });
  });

  it("recognizes Wrangler's explicit true dry-run value", () => {
    expect(
      selectCloudflareDeployPlan(["deploy", "--dry-run=true"], {
        CLOUDFLARE_WORKER_NAME: "example-app",
      }),
    ).toEqual({
      buildArgs: ["run", "build:app"],
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["deploy", "--name", "example-app", "--dry-run=true"],
    });
  });

  it("keeps Wrangler's explicit false dry-run value on the deploy path", () => {
    expect(
      selectCloudflareDeployPlan(["deploy", "--dry-run=false"], {
        CLOUDFLARE_WORKER_NAME: "example-app",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toEqual({
      buildArgs: ["run", "build:cloudflare"],
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["deploy", "--name", "example-app", "--dry-run=false"],
    });
  });

  it("uses the complete Cloudflare build before a local deploy", () => {
    expect(
      selectCloudflareDeployPlan(["preview"], {
        CLOUDFLARE_WORKER_NAME: "example-app",
      }),
    ).toEqual({
      buildArgs: ["run", "build:cloudflare"],
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["versions", "upload", "--name", "example-app"],
    });
  });

  it("uploads the built production assets to Convex after a main Workers Build", () => {
    expect(
      selectCloudflareDeployPlan(["deploy"], {
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "main",
        WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
      }),
    ).toEqual({
      buildArgs: null,
      previewAuth: null,
      convexStaticHostingArgs: [
        "exec",
        "static-hosting",
        "upload",
        "--dist",
        "./dist/client",
        "--prod",
      ],
      wranglerArgs: ["deploy", "--name", "connected-worker"],
    });
  });

  it("does not upload preview assets to the production Convex site", () => {
    expect(
      selectCloudflareDeployPlan(["preview"], {
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "main",
        WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
      }),
    ).toEqual({
      buildArgs: null,
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["versions", "upload", "--name", "connected-worker"],
    });
  });

  it("does not upload a non-main deploy to the production Convex site", () => {
    expect(
      selectCloudflareDeployPlan(["deploy"], {
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "feature-branch",
        WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
      }),
    ).toEqual({
      buildArgs: null,
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["deploy", "--name", "connected-worker"],
    });
  });

  it("does not upload a production dry-run to Convex", () => {
    expect(
      selectCloudflareDeployPlan(["deploy", "--dry-run"], {
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "main",
        WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
      }),
    ).toEqual({
      buildArgs: null,
      convexStaticHostingArgs: null,
      previewAuth: null,
      wranglerArgs: ["deploy", "--name", "connected-worker", "--dry-run"],
    });
  });

  it("rejects Wrangler flags that can replace the connected Worker name", () => {
    const env = { CLOUDFLARE_WORKER_NAME: "example-app" };

    expect(() => selectCloudflareDeployPlan(["deploy", "--name", "other"], env)).toThrow(
      "Do not pass Wrangler --name/-n manually",
    );
    expect(() => selectCloudflareDeployPlan(["deploy", "--name=other"], env)).toThrow(
      "Do not pass Wrangler --name/-n manually",
    );
    expect(() => selectCloudflareDeployPlan(["deploy", "-n", "other"], env)).toThrow(
      "Do not pass Wrangler --name/-n manually",
    );
  });

  it("rejects an option terminator that can hide a later dry-run flag", () => {
    expect(() =>
      selectCloudflareDeployPlan(["deploy", "--", "--dry-run=true"], {
        CLOUDFLARE_WORKER_NAME: "example-app",
      }),
    ).toThrow("Do not pass a standalone -- to Wrangler");
  });
});
