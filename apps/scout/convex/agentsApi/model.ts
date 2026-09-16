import { v } from "convex/values";
import { item, toolResult, usage } from "../../shared/openaiAgents";

export const sessionState = v.union(
  v.object({ kind: v.literal("starting") }),
  v.object({ kind: v.literal("running") }),
  v.object({ kind: v.literal("checking"), checkId: v.id("agentsApiRequestChecks") }),
  v.object({
    kind: v.literal("waiting"),
    message: v.string(),
    callId: v.string(),
    turnId: v.string(),
  }),
  v.object({ kind: v.literal("idle") }),
  v.object({ kind: v.literal("stopped") }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
);

export const browserHandle = v.object({
  providerSessionId: v.string(),
  cdpUrl: v.string(),
  interactiveLiveViewUrl: v.union(v.string(), v.null()),
  liveViewUrl: v.union(v.string(), v.null()),
  selectedTabId: v.optional(v.string()),
  currentUrl: v.union(v.string(), v.null()),
});

export const sessionUsage = usage;

export const sessionItem = item;

export const command = v.union(
  v.object({
    kind: v.literal("start"),
    prompt: v.string(),
    checkId: v.id("agentsApiRequestChecks"),
  }),
  v.object({ kind: v.literal("send"), message: v.string() }),
  v.object({ kind: v.literal("resume"), checkId: v.id("agentsApiRequestChecks") }),
);

export const callResult = v.union(v.object({ kind: v.literal("running") }), toolResult);
