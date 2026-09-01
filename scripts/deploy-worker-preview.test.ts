import { describe, expect, it } from "vite-plus/test";

import { selectWorkerPreviewArgs } from "./deploy-worker-preview.ts";

describe("deploy-worker-preview", () => {
  it("passes the connected Workers Build name to Wrangler", () => {
    expect(
      selectWorkerPreviewArgs({
        CLOUDFLARE_WORKER_NAME: "local-worker",
        WRANGLER_CI_OVERRIDE_NAME: "connected-worker",
      }),
    ).toEqual(["preview", "--worker-name", "connected-worker"]);
  });

  it("uses the explicit local Worker name outside Workers Builds", () => {
    expect(
      selectWorkerPreviewArgs({
        CLOUDFLARE_WORKER_NAME: "local-worker",
      }),
    ).toEqual(["preview", "--worker-name", "local-worker"]);
  });

  it("fails before Wrangler runs without a Worker name", () => {
    expect(() => selectWorkerPreviewArgs({})).toThrow("Missing Worker name");
  });
});
