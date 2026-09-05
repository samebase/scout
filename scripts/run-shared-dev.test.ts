import { describe, expect, it } from "vite-plus/test";
import { sharedDevEnvironment } from "./run-shared-dev.ts";

describe("shared development target", () => {
  it.each([
    "https://acoustic-cat-488.convex.cloud",
    "https://acoustic-cat-488.eu-west-1.convex.cloud",
  ])("accepts a matching cloud development URL: %s", (url) => {
    expect(
      sharedDevEnvironment.safeParse({
        CONVEX_DEPLOYMENT: "dev:acoustic-cat-488",
        VITE_CONVEX_URL: url,
      }).success,
    ).toBe(true);
  });

  it.each(["prod:acoustic-cat-488", "anonymous:anonymous-agent", "preview:acoustic-cat-488"])(
    "rejects a non-development target: %s",
    (deployment) => {
      expect(
        sharedDevEnvironment.safeParse({
          CONVEX_DEPLOYMENT: deployment,
          VITE_CONVEX_URL: "https://acoustic-cat-488.convex.cloud",
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    "http://127.0.0.1:3210",
    "https://another-deployment.convex.cloud",
    "https://acoustic-cat-488.convex.cloud.example.com",
    "https://acoustic-cat-488.convex.cloud@another-deployment.convex.cloud",
  ])("rejects a URL outside the selected development deployment: %s", (url) => {
    expect(
      sharedDevEnvironment.safeParse({
        CONVEX_DEPLOYMENT: "dev:acoustic-cat-488",
        VITE_CONVEX_URL: url,
      }).success,
    ).toBe(false);
  });
});
