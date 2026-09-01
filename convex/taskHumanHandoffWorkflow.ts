import { defineEvent, WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components } from "./_generated/api";

export const taskHumanHandoffOutcomeEvent = defineEvent({
  name: "taskHumanHandoffOutcome",
  validator: v.union(
    v.object({ kind: v.literal("continued") }),
    v.object({ kind: v.literal("expired") }),
    v.object({ kind: v.literal("failed") }),
  ),
});

export const taskHumanHandoffScoutPausedEvent = defineEvent({
  name: "taskHumanHandoffScoutPaused",
  validator: v.null(),
});

export const taskHumanHandoffWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 1_000,
      base: 2,
    },
    retryActionsByDefault: true,
    maxParallelism: 4,
  },
});
