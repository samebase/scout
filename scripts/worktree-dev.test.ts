import { describe, expect, test } from "vite-plus/test";
import {
  buildWorktreeEnvironment,
  preferredWorktreePort,
  readWorktreeBackend,
  worktreeAuthDefine,
  WORKTREE_ACCOUNT,
} from "./run-worktree-dev.ts";

describe("worktree development", () => {
  test("removes every inherited deployment selector", () => {
    expect(
      buildWorktreeEnvironment({
        CONVEX_DEPLOYMENT: "prod:real",
        CONVEX_DEPLOY_KEY: "secret",
        CONVEX_DEPLOYMENT_TOKEN: "secret",
        CONVEX_SELF_HOSTED_URL: "https://remote.example",
        CONVEX_SELF_HOSTED_ADMIN_KEY: "secret",
        CONVEX_OVERRIDE_ACCESS_TOKEN: "secret",
      }),
    ).toMatchObject({
      CONVEX_AGENT_MODE: "anonymous",
      CONVEX_DEPLOYMENT: "",
      CONVEX_DEPLOY_KEY: "",
      CONVEX_DEPLOYMENT_TOKEN: "",
      CONVEX_SELF_HOSTED_URL: "",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
      CONVEX_OVERRIDE_ACCESS_TOKEN: "",
      SCOUT_WORKTREE_DEV: "true",
    });
  });

  test("accepts only anonymous loopback backend metadata", () => {
    expect(
      readWorktreeBackend({
        CONVEX_DEPLOYMENT: "anonymous:anonymous-agent",
        VITE_CONVEX_URL: "http://127.0.0.1:3210",
      }),
    ).toEqual({
      deployment: "anonymous:anonymous-agent",
      url: "http://127.0.0.1:3210",
    });
    expect(() =>
      readWorktreeBackend({
        CONVEX_DEPLOYMENT: "dev:remote",
        VITE_CONVEX_URL: "https://remote.convex.cloud",
      }),
    ).toThrow();
  });

  test("injects credentials only into a linked worktree dev server", () => {
    const enabled = worktreeAuthDefine({
      command: "serve",
      mode: "development",
      linked: true,
      env: { SCOUT_WORKTREE_DEV: "true", VITE_CONVEX_URL: "http://127.0.0.1:3210" },
    });
    expect(enabled["import.meta.env.VITE_WORKTREE_AUTH_EMAIL"]).toBe(
      JSON.stringify(WORKTREE_ACCOUNT.email),
    );
    for (const input of [
      { command: "build", mode: "production", linked: true },
      { command: "serve", mode: "development", linked: false },
    ]) {
      expect(worktreeAuthDefine({ ...input, env: {} })).toEqual({
        "import.meta.env.VITE_WORKTREE_AUTH_EMAIL": '""',
        "import.meta.env.VITE_WORKTREE_AUTH_PASSWORD": '""',
      });
    }
  });

  test("chooses distinct stable preferred ports", () => {
    expect(preferredWorktreePort("/tmp/one")).toBe(preferredWorktreePort("/tmp/one"));
    expect(preferredWorktreePort("/tmp/one")).not.toBe(preferredWorktreePort("/tmp/two"));
  });
});
