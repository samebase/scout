import { describe, expect, it } from "vite-plus/test";

import { verifyCurrentBranchHead } from "./verify-current-branch-head.ts";

describe("verify-current-branch-head", () => {
  it("accepts a checkout at the head of its pull request branch", () => {
    verifyCurrentBranchHead(
      { GITHUB_ACTIONS: "true", GITHUB_HEAD_REF: "feature", GITHUB_REF_NAME: "220/merge" },
      (branch) => {
        expect(branch).toBe("feature");
        return "new";
      },
      () => "new",
    );
  });

  it("rejects a checkout after a newer commit reaches its branch", () => {
    expect(() =>
      verifyCurrentBranchHead(
        { GITHUB_ACTIONS: "true", GITHUB_HEAD_REF: "", GITHUB_REF_NAME: "main" },
        (branch) => {
          expect(branch).toBe("main");
          return "new";
        },
        () => "old",
      ),
    ).toThrow("old is stale: main now points to new. Refusing to deploy this stale build.");
  });

  it("fails closed without a branch name", () => {
    expect(() =>
      verifyCurrentBranchHead(
        { GITHUB_ACTIONS: "true" },
        () => "new",
        () => "new",
      ),
    ).toThrow("GITHUB_REF_NAME");
  });

  it("skips the check outside GitHub Actions", () => {
    expect(() =>
      verifyCurrentBranchHead(
        {},
        () => "unused",
        () => "unused",
      ),
    ).not.toThrow();
  });
});
