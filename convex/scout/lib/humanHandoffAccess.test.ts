import { describe, expect, test } from "vite-plus/test";
import {
  createHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
  humanHandoffOrigin,
  humanHandoffUrl,
  isHumanHandoffAccessToken,
} from "./humanHandoffAccess";

describe("human handoff bearer", () => {
  test("requires SITE_URL only when creating a handoff", () => {
    expect(() => humanHandoffOrigin(undefined)).toThrow(
      "SITE_URL is required to create a human handoff",
    );
  });

  test("creates a random 256-bit token and persists only its digest", () => {
    const first = createHumanHandoffAccessToken();
    const second = createHumanHandoffAccessToken();

    expect(first).not.toBe(second);
    expect(isHumanHandoffAccessToken(first)).toBe(true);
    expect(hashHumanHandoffAccessToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashHumanHandoffAccessToken(first)).not.toContain(first);
  });

  test.each([
    "http://scout.example",
    "https://user:secret@scout.example",
    "https://scout.example/path",
    "https://scout.example/?query=1",
    "https://scout.example/#fragment",
  ])("rejects an untrusted application origin: %s", (origin) => {
    expect(() => humanHandoffOrigin(origin)).toThrow("secure application origin");
  });

  test("allows the local Convex Auth site URL during development", () => {
    expect(humanHandoffOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  test("puts the bearer in the fragment of a first-party URL", () => {
    const token = createHumanHandoffAccessToken();
    const url = humanHandoffUrl("https://scout.example", "handoff/id", token);

    expect(url).toBe(`https://scout.example/handoff/handoff%2Fid#access=${token}`);
    expect(new URL(url).search).toBe("");
  });
});
