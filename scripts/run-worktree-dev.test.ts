import { describe, expect, it } from "vite-plus/test";

import { requireWorktreeDeployment } from "./run-worktree-dev.ts";

describe("worktree deployment", () => {
  const primary = { CONVEX_DEPLOYMENT: "dev:primary-123" };

  it("uses an isolated cloud dev deployment", () => {
    expect(requireWorktreeDeployment({ CONVEX_DEPLOYMENT: "dev:worktree-456" }, primary)).toBe(
      "dev:worktree-456",
    );
  });

  it.each([undefined, "anonymous:anonymous-agent", "local:local-agent", "prod:production-123"])(
    "rejects an unsupported deployment before starting services: %s",
    (deployment) => {
      expect(() => requireWorktreeDeployment({ CONVEX_DEPLOYMENT: deployment }, primary)).toThrow(
        "requires a cloud deployment",
      );
    },
  );

  it("rejects the primary deployment and deploy-key overrides", () => {
    expect(() => requireWorktreeDeployment(primary, primary)).toThrow(
      "separate cloud dev deployment",
    );
    expect(() =>
      requireWorktreeDeployment(
        {
          CONVEX_DEPLOYMENT: "dev:worktree-456",
          CONVEX_DEPLOY_KEY: "override",
        },
        primary,
      ),
    ).toThrow("CONVEX_DEPLOY_KEY");
  });
});
