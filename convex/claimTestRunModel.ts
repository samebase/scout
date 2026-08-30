import { v } from "convex/values";

export const claimTestBrowserProfileSelectionValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), scoutId: v.id("scouts") }),
);

export const claimTestBrowserProfileValidator = v.union(
  v.object({ kind: v.literal("fresh") }),
  v.object({ kind: v.literal("scout"), profileName: v.string() }),
);

export const claimTestAccountCreationValidator = v.union(
  v.literal("required"),
  v.literal("not_requested"),
);

export const claimTestVerdictValidator = v.union(
  v.literal("supported"),
  v.literal("qualified"),
  v.literal("refuted"),
  v.literal("inconclusive"),
);

export const claimTestOutcomeValidator = v.object({
  verdict: claimTestVerdictValidator,
});

export const claimTestRunStateValidator = v.union(
  v.object({
    kind: v.literal("running"),
    generationId: v.id("scoutLabGenerations"),
  }),
  v.object({
    kind: v.literal("completed"),
    generationId: v.id("scoutLabGenerations"),
    completedAt: v.number(),
    outcome: claimTestOutcomeValidator,
  }),
  v.object({
    kind: v.literal("failed"),
    generationId: v.id("scoutLabGenerations"),
    failedAt: v.number(),
    failure: v.string(),
  }),
);

export function parseClaimTestOutcome(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  switch (firstLine) {
    case "Verdict: Supported":
      return { verdict: "supported" } as const;
    case "Verdict: Qualified":
      return { verdict: "qualified" } as const;
    case "Verdict: Refuted":
      return { verdict: "refuted" } as const;
    case "Verdict: Inconclusive":
      return { verdict: "inconclusive" } as const;
    default:
      return null;
  }
}
