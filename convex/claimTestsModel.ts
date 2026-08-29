import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { scoutModelValidator, scoutTokenUsageValidator } from "./scout/models";

const claimTestRunBaseValidator = v.object({
  runId: v.id("claimTestRuns"),
  investigationId: v.id("productInvestigations"),
  claimKey: v.string(),
  threadId: v.string(),
  experimentId: v.id("scoutLabExperiments"),
  createdAt: v.number(),
  scout: v.object({
    id: v.id("scouts"),
    displayName: v.string(),
  }),
});

const terminalGenerationMetadataFields = {
  usage: v.union(scoutTokenUsageValidator, v.null()),
  firecrawlCredits: v.union(v.number(), v.null()),
  firecrawlDurationMs: v.union(v.number(), v.null()),
};

export const claimTestLatestValidator = v.union(
  claimTestRunBaseValidator.extend({
    generation: v.object({
      status: v.literal("pending"),
      model: scoutModelValidator,
      startedAt: v.number(),
      leaseExpiresAt: v.number(),
    }),
  }),
  claimTestRunBaseValidator.extend({
    generation: v.object({
      status: v.literal("completed"),
      model: scoutModelValidator,
      startedAt: v.number(),
      completedAt: v.number(),
      ...terminalGenerationMetadataFields,
    }),
  }),
  claimTestRunBaseValidator.extend({
    generation: v.object({
      status: v.literal("failed"),
      model: scoutModelValidator,
      startedAt: v.number(),
      failedAt: v.number(),
      failure: v.string(),
      ...terminalGenerationMetadataFields,
    }),
  }),
);

export const startClaimTestResultValidator = v.object({
  runId: v.id("claimTestRuns"),
  threadId: v.string(),
  experimentId: v.id("scoutLabExperiments"),
  created: v.boolean(),
});

export async function completeClaimTestExperimentForGeneration(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"scoutLabGenerations">,
) {
  const liveView = await ctx.db
    .query("claimTestLiveViews")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (liveView) {
    await ctx.db.delete("claimTestLiveViews", liveView._id);
  }

  const run = await ctx.db
    .query("claimTestRuns")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (!run) return;

  const experiment = await ctx.db.get("scoutLabExperiments", run.experimentId);
  if (experiment && experiment.status !== "completed") {
    await ctx.db.patch("scoutLabExperiments", experiment._id, { status: "completed" });
  }
}
