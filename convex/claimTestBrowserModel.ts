import { v } from "convex/values";

export const claimTestBrowserActionValidator = v.union(
  v.object({ kind: v.literal("open"), url: v.string() }),
  v.object({ kind: v.literal("navigate"), url: v.string() }),
  v.object({ kind: v.literal("click"), ref: v.string() }),
  v.object({ kind: v.literal("fill"), ref: v.string(), characterCount: v.number() }),
  v.object({ kind: v.literal("type"), ref: v.string(), characterCount: v.number() }),
  v.object({ kind: v.literal("press"), key: v.string() }),
  v.object({ kind: v.literal("select"), ref: v.string() }),
  v.object({ kind: v.literal("check"), ref: v.string() }),
  v.object({ kind: v.literal("back") }),
  v.object({ kind: v.literal("reload") }),
  v.object({ kind: v.literal("switch_tab"), tabId: v.string() }),
);

export const claimTestBrowserTabValidator = v.object({
  tabId: v.string(),
  title: v.string(),
  url: v.union(v.string(), v.null()),
  active: v.boolean(),
});

export const claimTestBrowserObservationValidator = v.object({
  capturedAtMs: v.number(),
  tabs: v.array(claimTestBrowserTabValidator),
});

export const claimTestBrowserPointerValidator = v.object({
  tabId: v.string(),
  ref: v.string(),
  box: v.object({
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
});

export const claimTestBrowserTelemetryValidator = v.object({
  version: v.literal(1),
  before: claimTestBrowserObservationValidator,
  dispatchedAtMs: v.number(),
  returnedAtMs: v.number(),
  after: claimTestBrowserObservationValidator,
  pointer: v.union(claimTestBrowserPointerValidator, v.null()),
});

export const claimTestBrowserOutcomeValidator = v.union(
  v.object({ kind: v.literal("applied"), telemetry: claimTestBrowserTelemetryValidator }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    telemetry: claimTestBrowserTelemetryValidator,
  }),
  v.object({ kind: v.literal("failed_before_dispatch"), failure: v.string() }),
  v.object({ kind: v.literal("indeterminate_after_dispatch"), failure: v.string() }),
);

export const claimTestBrowserOperationStateValidator = v.union(
  v.object({ kind: v.literal("prepared"), preparedAtMs: v.number() }),
  v.object({
    kind: v.literal("applied"),
    settledAtMs: v.number(),
    telemetry: claimTestBrowserTelemetryValidator,
  }),
  v.object({
    kind: v.literal("applied_snapshot_failed"),
    settledAtMs: v.number(),
    telemetry: claimTestBrowserTelemetryValidator,
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

export const claimTestBrowserSessionLifecycleValidator = v.union(
  v.object({ kind: v.literal("active"), openedAtMs: v.number() }),
  v.object({
    kind: v.literal("closed"),
    openedAtMs: v.number(),
    closedAtMs: v.number(),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  }),
);

export const claimTestBrowserViewportValidator = v.object({
  width: v.number(),
  height: v.number(),
});

export const claimTestBrowserOperationValidator = v.object({
  operationId: v.id("claimTestBrowserOperations"),
  sequence: v.number(),
  toolCallId: v.string(),
  action: claimTestBrowserActionValidator,
  state: claimTestBrowserOperationStateValidator,
});
