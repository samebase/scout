import { describe, expect, test, vi } from "vite-plus/test";
import { consumeHumanHandoffAccessToken, humanHandoffIsTopLevel } from "./human-handoff-access";

const token = `hh1_${"a".repeat(43)}`;

function browser(hash: string) {
  const replaceState = vi.fn();
  return {
    location: { hash, pathname: "/handoff/handoff-1", search: "" },
    history: { replaceState, state: { test: true } },
    replaceState,
  };
}

describe("human handoff browser access", () => {
  test("returns an exact bearer and scrubs the fragment immediately", () => {
    const fixture = browser(`#access=${token}`);

    expect(consumeHumanHandoffAccessToken(fixture)).toBe(token);
    expect(fixture.replaceState).toHaveBeenCalledWith({ test: true }, "", "/handoff/handoff-1");
  });

  test.each([
    "#access=short",
    `#access=${token}&extra=1`,
    `#other=${token}`,
    "#access=",
    `#access=${token.replace("a", "%61")}`,
  ])("rejects %s after scrubbing it", (hash) => {
    const fixture = browser(hash);

    expect(consumeHumanHandoffAccessToken(fixture)).toBeNull();
    expect(fixture.replaceState).toHaveBeenCalledOnce();
  });

  test("requires a top-level browsing context", () => {
    const top = {};
    expect(humanHandoffIsTopLevel({ self: top, top })).toBe(true);
    expect(humanHandoffIsTopLevel({ self: {}, top })).toBe(false);
  });
});
