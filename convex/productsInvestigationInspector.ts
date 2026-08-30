import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAppUser } from "./access";
import { productInvestigationWorkflow } from "./productInvestigationWorkflow";
import { PRODUCT_INVESTIGATION_PROVIDER, PRODUCT_INVESTIGATION_EFFORT } from "./productsModel";
import { productInvestigationInspectorValidator } from "./productsInvestigationActivityModel";

function workflowStepStatus(
  result:
    | { kind: "success"; returnValue: unknown }
    | { kind: "failed"; error: string }
    | { kind: "canceled" }
    | undefined,
): "running" | "completed" | "failed" | "canceled" {
  if (result === undefined) return "running";
  switch (result.kind) {
    case "success":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export const get = query({
  args: { investigationId: v.id("productInvestigations") },
  returns: productInvestigationInspectorValidator,
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (
      !investigation ||
      investigation.requestedByUserId !== userId ||
      investigation.provider !== PRODUCT_INVESTIGATION_PROVIDER ||
      investigation.workflowId === undefined
    ) {
      return null;
    }

    const [workflowStatus, steps, activities] = await Promise.all([
      productInvestigationWorkflow.status(ctx, investigation.workflowId),
      productInvestigationWorkflow.listSteps(ctx, investigation.workflowId, {
        order: "asc",
        paginationOpts: { cursor: null, numItems: 16 },
      }),
      ctx.db
        .query("productInvestigationActivities")
        .withIndex("by_investigation_id_and_sequence", (index) =>
          index.eq("investigationId", investigation._id),
        )
        .take(32),
    ]);

    const state: "queued" | "running" | "completed" | "failed" | "canceled" =
      investigation.status === "queued"
        ? "queued"
        : workflowStatus.type === "inProgress"
          ? "running"
          : workflowStatus.type;
    const startedAt = investigation.status === "queued" ? null : (investigation.startedAt ?? null);
    const finishedAt =
      investigation.status === "completed"
        ? investigation.completedAt
        : investigation.status === "failed"
          ? investigation.failedAt
          : null;
    const retrieval = investigation.status === "queued" ? undefined : investigation.retrieval;
    const model: {
      provider: "OpenAI through Convex Agent";
      name: string;
      effort: string;
    } = {
      provider: "OpenAI through Convex Agent",
      name: investigation.requestedModel,
      effort: PRODUCT_INVESTIGATION_EFFORT,
    };

    return {
      investigationId: investigation._id,
      workflowId: investigation.workflowId,
      state,
      requestedAt: investigation.requestedAt,
      startedAt,
      finishedAt,
      failure: investigation.status === "failed" ? investigation.failure : null,
      firecrawlCredits: {
        used: retrieval?.totalCredits ?? 0,
        maximum: investigation.maxCredits,
      },
      model,
      activities: activities.map((activity) => ({
        id: activity._id,
        key: activity.key,
        sequence: activity.sequence,
        actor: activity.actor,
        operation: activity.operation,
        source: activity.source,
        lifecycle: activity.lifecycle,
      })),
      workflowSteps: steps.page.map((step) => ({
        stepNumber: step.stepNumber,
        name: step.name,
        status: workflowStepStatus(step.runResult),
        startedAt: step.startedAt,
        completedAt: step.completedAt ?? null,
      })),
    };
  },
});
