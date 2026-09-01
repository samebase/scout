import { describe, expect, it } from "vite-plus/test";

import { main, selectProductionDeployPlan } from "./deploy-production.ts";

describe("deploy-production", () => {
  it("uploads the built frontend to production Convex Static Hosting after a main Workers Build", () => {
    expect(
      selectProductionDeployPlan({
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "main",
      }),
    ).toEqual({
      wranglerArgs: ["deploy"],
      staticHostingArgs: ["upload", "--dist", "./dist/client", "--prod"],
    });
  });

  it("does not upload production Static Hosting assets outside the main Workers Build", () => {
    expect(
      selectProductionDeployPlan({
        WORKERS_CI: "true",
        WORKERS_CI_BRANCH: "feature-branch",
      }),
    ).toEqual({
      wranglerArgs: ["deploy"],
      staticHostingArgs: null,
    });
  });

  it("runs the Static Hosting upload only after Wrangler succeeds", async () => {
    const calls: string[][] = [];

    await main(
      {
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
      },
      async (_entrypoint, args) => {
        calls.push([...args]);
      },
    );

    expect(calls).toEqual([["deploy"], ["upload", "--dist", "./dist/client", "--prod"]]);
  });
});
