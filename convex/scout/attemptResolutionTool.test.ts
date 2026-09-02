import { describe, expect, it } from "vite-plus/test";
import { createAttemptResolutionTool } from "./attemptResolutionTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("attempt resolution tool", () => {
  it("can resolve only once", async () => {
    let calls = 0;
    const tool = createAttemptResolutionTool(async (resolution) => {
      calls += 1;
      return { ...resolution, resolvedAt: 1 };
    });

    await expect(
      tool.execute!({ kind: "completed", conclusion: " Finished " }, toolOptions),
    ).resolves.toEqual({ kind: "completed", conclusion: "Finished", resolvedAt: 1 });
    await expect(
      tool.execute!({ kind: "blocked", conclusion: "Stopped" }, toolOptions),
    ).rejects.toThrow("only once");
    expect(calls).toBe(1);
  });

  it("validates a non-empty conclusion without an arbitrary length failure", async () => {
    const tool = createAttemptResolutionTool(async (resolution) => ({
      ...resolution,
      resolvedAt: 1,
    }));

    await expect(
      tool.execute!({ kind: "blocked", conclusion: "   " }, toolOptions),
    ).rejects.toThrow();
    await expect(
      tool.execute!({ kind: "blocked", conclusion: "x".repeat(501) }, toolOptions),
    ).resolves.toMatchObject({ kind: "blocked", conclusion: "x".repeat(501) });
  });

  it("does not consume its single use when persistence fails", async () => {
    let attempts = 0;
    const tool = createAttemptResolutionTool(async (resolution) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return { ...resolution, resolvedAt: 1 };
    });

    await expect(
      tool.execute!({ kind: "completed", conclusion: "Finished" }, toolOptions),
    ).rejects.toThrow("temporary failure");
    await expect(
      tool.execute!({ kind: "completed", conclusion: "Finished" }, toolOptions),
    ).resolves.toEqual({ kind: "completed", conclusion: "Finished", resolvedAt: 1 });
  });
});
