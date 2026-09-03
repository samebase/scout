import { v } from "convex/values";

export const browserActionValidator = v.union(
  v.object({ kind: v.literal("open"), url: v.string() }),
  v.object({ kind: v.literal("execute"), code: v.string() }),
  v.object({ kind: v.literal("managed_password_fill"), fieldCount: v.number() }),
);

export const browserTabValidator = v.object({
  tabId: v.string(),
  title: v.string(),
  url: v.union(v.string(), v.null()),
  active: v.boolean(),
});

export const browserObservationValidator = v.object({
  capturedAtMs: v.number(),
  tabs: v.array(browserTabValidator),
});

export const browserTelemetryValidator = v.object({
  version: v.literal(1),
  before: browserObservationValidator,
  dispatchedAtMs: v.number(),
  returnedAtMs: v.number(),
  after: browserObservationValidator,
});

export const browserOutcomeValidator = v.union(
  v.object({ kind: v.literal("applied"), telemetry: browserTelemetryValidator }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    telemetry: browserTelemetryValidator,
  }),
  v.object({ kind: v.literal("failed_before_dispatch"), failure: v.string() }),
  v.object({ kind: v.literal("indeterminate_after_dispatch"), failure: v.string() }),
);

export const browserOperationStateValidator = v.union(
  v.object({ kind: v.literal("prepared"), preparedAtMs: v.number() }),
  v.object({
    kind: v.literal("applied"),
    settledAtMs: v.number(),
    telemetry: browserTelemetryValidator,
  }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    settledAtMs: v.number(),
    telemetry: browserTelemetryValidator,
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

export const browserSessionLifecycleValidator = v.union(
  v.object({ kind: v.literal("active"), openedAtMs: v.number() }),
  v.object({
    kind: v.literal("closed"),
    openedAtMs: v.number(),
    closedAtMs: v.number(),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
);

export const browserViewportValidator = v.object({
  width: v.number(),
  height: v.number(),
});
