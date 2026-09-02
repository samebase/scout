import { v } from "convex/values";

export const taskBrowserActionValidator = v.union(
  v.object({ kind: v.literal("open"), url: v.string() }),
  v.object({ kind: v.literal("execute"), code: v.string() }),
  v.object({ kind: v.literal("managed_password_fill"), fieldCount: v.number() }),
);

export const taskBrowserTabValidator = v.object({
  tabId: v.string(),
  title: v.string(),
  url: v.union(v.string(), v.null()),
  active: v.boolean(),
});

export const taskBrowserObservationValidator = v.object({
  capturedAtMs: v.number(),
  tabs: v.array(taskBrowserTabValidator),
});

export const taskBrowserTelemetryValidator = v.object({
  version: v.literal(1),
  before: taskBrowserObservationValidator,
  dispatchedAtMs: v.number(),
  returnedAtMs: v.number(),
  after: taskBrowserObservationValidator,
});

export const taskBrowserOutcomeValidator = v.union(
  v.object({ kind: v.literal("applied"), telemetry: taskBrowserTelemetryValidator }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    telemetry: taskBrowserTelemetryValidator,
  }),
  v.object({ kind: v.literal("failed_before_dispatch"), failure: v.string() }),
  v.object({ kind: v.literal("indeterminate_after_dispatch"), failure: v.string() }),
);

export const taskBrowserOperationStateValidator = v.union(
  v.object({ kind: v.literal("prepared"), preparedAtMs: v.number() }),
  v.object({
    kind: v.literal("applied"),
    settledAtMs: v.number(),
    telemetry: taskBrowserTelemetryValidator,
  }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    settledAtMs: v.number(),
    telemetry: taskBrowserTelemetryValidator,
  }),
  v.object({
    kind: v.literal("failed_before_dispatch"),
    settledAtMs: v.number(),
    failure: v.string(),
  }),
  v.object({
    kind: v.literal("indeterminate_after_dispatch"),
    settledAtMs: v.number(),
    failure: v.string(),
  }),
);

export const taskBrowserSessionLifecycleValidator = v.union(
  v.object({ kind: v.literal("active"), openedAtMs: v.number() }),
  v.object({
    kind: v.literal("closed"),
    openedAtMs: v.number(),
    closedAtMs: v.number(),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
);

export const taskBrowserViewportValidator = v.object({
  width: v.number(),
  height: v.number(),
});

export const taskBrowserOperationValidator = v.object({
  operationId: v.id("taskBrowserOperations"),
  sequence: v.number(),
  toolCallId: v.string(),
  action: taskBrowserActionValidator,
  state: taskBrowserOperationStateValidator,
});
