import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  claimTestBrowserOperationValidator,
  claimTestBrowserSessionLifecycleValidator,
  claimTestBrowserViewportValidator,
} from "./claimTestBrowserModel";
import { expireClaimTestHumanHandoffForGeneration } from "./claimTestHumanHandoffsModel";
import {
  claimTestAccountCreationValidator,
  claimTestBrowserProfileValidator,
  claimTestOutcomeValidator,
  claimTestRunStateValidator,
} from "./claimTestRunModel";
import { productClaimSnapshotValidator } from "./productsModel";
import { scoutModelValidator, scoutTokenUsageValidator } from "./scout/models";

const MAX_BROWSER_OPERATIONS_PER_SESSION = 100;

const claimTestRunBaseValidator = v.object({
  runId: v.id("claimTestRuns"),
  investigationId: v.id("productInvestigations"),
  claimKey: v.string(),
  threadId: v.string(),
  experimentId: v.id("scoutLabExperiments"),
  createdAt: v.number(),
  matchesCurrentClaim: v.boolean(),
  testedClaim: productClaimSnapshotValidator,
  browserProfile: claimTestBrowserProfileValidator,
  accountCreation: claimTestAccountCreationValidator,
  state: claimTestRunStateValidator,
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

export const claimTestGenerationValidator = v.union(
  v.object({
    generationId: v.id("scoutLabGenerations"),
    status: v.literal("pending"),
    model: scoutModelValidator,
    startedAt: v.number(),
    leaseExpiresAt: v.number(),
  }),
  v.object({
    generationId: v.id("scoutLabGenerations"),
    status: v.literal("completed"),
    model: scoutModelValidator,
    startedAt: v.number(),
    completedAt: v.number(),
    ...terminalGenerationMetadataFields,
  }),
  v.object({
    generationId: v.id("scoutLabGenerations"),
    status: v.literal("failed"),
    model: scoutModelValidator,
    startedAt: v.number(),
    failedAt: v.number(),
    failure: v.string(),
    ...terminalGenerationMetadataFields,
  }),
);

export const claimTestRunValidator = claimTestRunBaseValidator.extend({
  generation: claimTestGenerationValidator,
});

export const claimTestRunsValidator = v.array(claimTestRunValidator);

export const claimTestStatusValidator = v.object({
  claimKey: v.string(),
  state: v.union(
    v.literal("untested"),
    v.literal("testing"),
    v.literal("tested"),
    v.literal("inconclusive"),
    v.literal("failed"),
    v.literal("needs_retest"),
  ),
});

export const claimTestStatusesValidator = v.array(claimTestStatusValidator);

export const startClaimTestResultValidator = v.object({
  runId: v.id("claimTestRuns"),
  threadId: v.string(),
  experimentId: v.id("scoutLabExperiments"),
  created: v.boolean(),
});

export const continueClaimTestResultValidator = v.object({
  runId: v.id("claimTestRuns"),
  generationId: v.id("scoutLabGenerations"),
  threadId: v.string(),
});

export const claimTestBrowserSessionSummaryValidator = v.object({
  sessionId: v.id("claimTestBrowserSessions"),
  generationId: v.id("scoutLabGenerations"),
  sequence: v.number(),
  createdAt: v.number(),
  provider: v.literal("firecrawl"),
  profileName: v.union(v.string(), v.null()),
  viewport: claimTestBrowserViewportValidator,
  lifecycle: claimTestBrowserSessionLifecycleValidator,
  operationCount: v.number(),
});

export const claimTestBrowserSessionsValidator = v.array(claimTestBrowserSessionSummaryValidator);

export const claimTestBrowserSessionDetailValidator =
  claimTestBrowserSessionSummaryValidator.extend({
    runId: v.id("claimTestRuns"),
    operations: v.array(claimTestBrowserOperationValidator),
  });

export function projectClaimTestGeneration(
  generation: Doc<"scoutLabGenerations">,
): Infer<typeof claimTestGenerationValidator> {
  const base = {
    generationId: generation._id,
    model: generation.model,
    startedAt: generation.startedAt,
  };
  const terminalMetadata = {
    usage: generation.usage ?? null,
    firecrawlCredits: generation.firecrawlCredits ?? null,
    firecrawlDurationMs: generation.firecrawlDurationMs ?? null,
  };
  switch (generation.status) {
    case "pending":
      return { ...base, status: "pending", leaseExpiresAt: generation.leaseExpiresAt };
    case "completed":
      if (generation.completedAt === undefined) {
        throw new Error("Completed claim test generation is missing its completion time");
      }
      return {
        ...base,
        status: "completed",
        completedAt: generation.completedAt,
        ...terminalMetadata,
      };
    case "failed":
      if (generation.failedAt === undefined || generation.failure === undefined) {
        throw new Error("Failed claim test generation is missing failure metadata");
      }
      return {
        ...base,
        status: "failed",
        failedAt: generation.failedAt,
        failure: generation.failure,
        ...terminalMetadata,
      };
  }
}

type ClaimTestGenerationSettlement =
  | { kind: "completed"; outcome: Infer<typeof claimTestOutcomeValidator> | null }
  | { kind: "failed"; failure: string };

async function endActiveBrowserSessionForGeneration(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"scoutLabGenerations">,
  now: number,
) {
  const session = await ctx.db
    .query("claimTestBrowserSessions")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (!session || session.lifecycle.kind !== "active") return;
  await ctx.db.patch("claimTestBrowserSessions", session._id, {
    lifecycle: {
      kind: "closed",
      openedAtMs: session.lifecycle.openedAtMs,
      closedAtMs: now,
      providerDurationMs: null,
      creditsBilled: null,
    },
  });
}

async function hasAppliedBrowserEvidence(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"scoutLabGenerations">,
) {
  const session = await ctx.db
    .query("claimTestBrowserSessions")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (!session) return false;
  const operations = await ctx.db
    .query("claimTestBrowserOperations")
    .withIndex("by_session_id_and_sequence", (query) => query.eq("sessionId", session._id))
    .take(MAX_BROWSER_OPERATIONS_PER_SESSION);
  return operations.some(
    (operation) =>
      operation.state.kind === "applied" || operation.state.kind === "applied_snapshot_failed",
  );
}

async function hasRecordedAccountEvidence(
  ctx: Pick<MutationCtx, "db">,
  run: Doc<"claimTestRuns">,
  generationId: Id<"scoutLabGenerations">,
) {
  if (run.serviceAccountId === undefined) return false;
  const account = await ctx.db.get("scoutServiceAccounts", run.serviceAccountId);
  return (
    account?.scoutId === run.scoutId &&
    account.productId === run.productId &&
    account.lastVerifiedByClaimTest?.runId === run._id &&
    account.lastVerifiedByClaimTest.generationId === generationId
  );
}

export async function settleClaimTestRunForGeneration(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"scoutLabGenerations">,
  settlement: ClaimTestGenerationSettlement,
) {
  const now = Date.now();
  await expireClaimTestHumanHandoffForGeneration(ctx, generationId);

  const liveView = await ctx.db
    .query("claimTestLiveViews")
    .withIndex("by_generation_id", (query) => query.eq("generationId", generationId))
    .unique();
  if (liveView) await ctx.db.delete("claimTestLiveViews", liveView._id);
  await endActiveBrowserSessionForGeneration(ctx, generationId, now);

  const generation = await ctx.db.get("scoutLabGenerations", generationId);
  if (!generation) return;
  const run = await ctx.db
    .query("claimTestRuns")
    .withIndex("by_thread_id", (query) => query.eq("threadId", generation.threadId))
    .unique();
  if (!run || run.state.kind !== "running" || run.state.generationId !== generationId) return;

  const supportedByBrowserEvidence =
    settlement.kind === "completed" &&
    settlement.outcome !== null &&
    (settlement.outcome.verdict === "inconclusive" ||
      (await hasAppliedBrowserEvidence(ctx, generationId)));
  const supportedByRequiredAccountEvidence =
    settlement.kind === "completed" &&
    settlement.outcome !== null &&
    (run.accountCreation !== "required" ||
      (settlement.outcome.verdict !== "supported" && settlement.outcome.verdict !== "qualified") ||
      (await hasRecordedAccountEvidence(ctx, run, generationId)));

  if (
    settlement.kind === "completed" &&
    settlement.outcome !== null &&
    supportedByBrowserEvidence &&
    supportedByRequiredAccountEvidence
  ) {
    await ctx.db.patch("claimTestRuns", run._id, {
      state: {
        kind: "completed",
        generationId,
        completedAt: now,
        outcome: settlement.outcome,
      },
    });
  } else {
    await ctx.db.patch("claimTestRuns", run._id, {
      state: {
        kind: "failed",
        generationId,
        failedAt: now,
        failure:
          settlement.kind === "failed"
            ? settlement.failure
            : settlement.outcome !== null && settlement.outcome.verdict !== "inconclusive"
              ? !supportedByBrowserEvidence
                ? "Scout returned a claim verdict without captured browser evidence"
                : "Scout returned a successful account-creation verdict without recording authenticated account evidence"
              : "Scout completed without an exact claim verdict",
      },
    });
  }

  const experiment = await ctx.db.get("scoutLabExperiments", run.experimentId);
  if (experiment && experiment.status !== "completed") {
    await ctx.db.patch("scoutLabExperiments", experiment._id, { status: "completed" });
  }
}
