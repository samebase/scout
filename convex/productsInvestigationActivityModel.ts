import { v } from "convex/values";

export const productInvestigationActivityActorValidator = v.union(
  v.literal("Firecrawl"),
  v.literal("Scout"),
  v.literal("OpenAI through Convex Agent"),
);

export const productInvestigationActivitySourceValidator = v.union(
  v.object({ kind: v.literal("local") }),
  v.object({
    kind: v.literal("external"),
    request: v.object({
      method: v.union(v.literal("POST"), v.null()),
      url: v.union(v.string(), v.null()),
      body: v.string(),
    }),
  }),
);

export const productInvestigationActivityMetricValidator = v.object({
  label: v.string(),
  value: v.string(),
});

export const productInvestigationActivityLifecycleValidator = v.union(
  v.object({
    status: v.literal("running"),
    attempt: v.number(),
    startedAt: v.number(),
  }),
  v.object({
    status: v.literal("completed"),
    attempt: v.number(),
    startedAt: v.number(),
    completedAt: v.number(),
    metrics: v.array(productInvestigationActivityMetricValidator),
  }),
  v.object({
    status: v.literal("failed"),
    attempt: v.number(),
    startedAt: v.number(),
    failedAt: v.number(),
    failure: v.string(),
  }),
  v.object({
    status: v.literal("skipped"),
    skippedAt: v.number(),
    reason: v.string(),
  }),
);

export const productInvestigationActivityFieldsValidator = v.object({
  investigationId: v.id("productInvestigations"),
  key: v.string(),
  sequence: v.number(),
  actor: productInvestigationActivityActorValidator,
  operation: v.string(),
  source: productInvestigationActivitySourceValidator,
  lifecycle: productInvestigationActivityLifecycleValidator,
});

export const productInvestigationActivityPublicValidator = v.object({
  id: v.id("productInvestigationActivities"),
  key: v.string(),
  sequence: v.number(),
  actor: productInvestigationActivityActorValidator,
  operation: v.string(),
  source: productInvestigationActivitySourceValidator,
  lifecycle: productInvestigationActivityLifecycleValidator,
});

export const productInvestigationWorkflowStateValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const productInvestigationWorkflowStepPublicValidator = v.object({
  stepNumber: v.number(),
  name: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
  startedAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
});

export const productInvestigationInspectorValidator = v.union(
  v.null(),
  v.object({
    investigationId: v.id("productInvestigations"),
    workflowId: v.string(),
    state: productInvestigationWorkflowStateValidator,
    requestedAt: v.number(),
    startedAt: v.union(v.number(), v.null()),
    finishedAt: v.union(v.number(), v.null()),
    failure: v.union(v.string(), v.null()),
    firecrawlCredits: v.object({ used: v.number(), maximum: v.number() }),
    model: v.object({
      provider: v.literal("OpenAI through Convex Agent"),
      name: v.string(),
      effort: v.string(),
    }),
    activities: v.array(productInvestigationActivityPublicValidator),
    workflowSteps: v.array(productInvestigationWorkflowStepPublicValidator),
  }),
);
