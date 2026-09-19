import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import { agentsApiUsageValidator } from "./cost";
import { creditFailureCodeValidator } from "../creditsModel";
import { taskFailureDiagnosticValidator } from "../../shared/taskFailure";

export const taskEngine = v.union(v.literal("agents_api"), v.literal("convex_agent"));

export const handoffContext = v.object({
  message: v.string(),
  callId: v.string(),
  turnId: v.string(),
  // Existing handoffs and resume checks predate saved deadlines.
  expiresAt: v.optional(v.number()),
});

export const pendingMessage = v.object({
  message: v.string(),
  workflowId: vWorkflowId,
  status: v.union(v.literal("queued"), v.literal("submitting")),
});

export const sessionState = v.union(
  v.object({ kind: v.literal("starting") }),
  v.object({ kind: v.literal("running"), resumedAtMs: v.optional(v.number()) }),
  v.object({ kind: v.literal("checking"), checkId: v.id("agentsApiRequestChecks") }),
  handoffContext.extend({ kind: v.literal("waiting") }),
  v.object({ kind: v.literal("idle") }),
  v.object({ kind: v.literal("stopped"), reason: v.optional(v.literal("handoff_expired")) }),
  v.object({
    kind: v.literal("failed"),
    error: v.string(),
    creditFailureCode: v.optional(creditFailureCodeValidator),
    diagnostic: v.optional(taskFailureDiagnosticValidator),
  }),
);

export const browserHandle = v.object({
  providerSessionId: v.string(),
  // Browsers opened before handoff expiration did not retain Firecrawl's expiry.
  providerExpiresAtMs: v.optional(v.number()),
  cdpUrl: v.string(),
  interactiveLiveViewUrl: v.union(v.string(), v.null()),
  liveViewUrl: v.union(v.string(), v.null()),
  selectedTabId: v.optional(v.string()),
  currentUrl: v.union(v.string(), v.null()),
});

export const sessionUsage = agentsApiUsageValidator;

// Captured in scheduled args so later turns cannot change who or what is billed.
export const agentsTurnBilling = v.object({
  userId: v.id("users"),
  providerId: v.string(),
  model: v.string(),
  turnId: v.union(v.string(), v.null()),
});

export const sessionItem = v.object({
  providerItemId: v.string(),
  kind: v.string(),
  text: v.string(),
  details: v.string(),
  complete: v.optional(v.boolean()),
});

export const command = v.union(
  v.object({
    kind: v.literal("start"),
    prompt: v.string(),
    checkId: v.id("agentsApiRequestChecks"),
  }),
  v.object({ kind: v.literal("send"), message: v.string() }),
  v.object({ kind: v.literal("resume"), checkId: v.id("agentsApiRequestChecks") }),
  v.object({ kind: v.literal("observe") }),
);

export const callResult = v.union(
  v.object({ kind: v.literal("running") }),
  v.object({ kind: v.literal("success"), output: v.string() }),
  v.object({ kind: v.literal("error"), error: v.string() }),
  v.object({ kind: v.literal("interrupted"), error: v.string() }),
);
