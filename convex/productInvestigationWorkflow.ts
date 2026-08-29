import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

export const productInvestigationWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 1_000,
      base: 2,
    },
    retryActionsByDefault: false,
    maxParallelism: 4,
  },
});
