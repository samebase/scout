import { v } from "convex/values";
import { agentsApiUsageValidator } from "./cost";
import { creditFailureCodeValidator } from "../creditsModel";

export const taskEngine = v.union(v.literal("agents_api"), v.literal("convex_agent"));

export const sessionState = v.union(
  v.object({ kind: v.literal("starting") }),
  v.object({ kind: v.literal("running"), resumedAtMs: v.optional(v.number()) }),
  v.object({ kind: v.literal("checking"), checkId: v.id("agentsApiRequestChecks") }),
  v.object({
    kind: v.literal("waiting"),
    message: v.string(),
    callId: v.string(),
    turnId: v.string(),
  }),
  v.object({ kind: v.literal("idle") }),
  v.object({ kind: v.literal("stopped") }),
  v.object({
    kind: v.literal("failed"),
    error: v.string(),
    creditFailureCode: v.optional(creditFailureCodeValidator),
  }),
);

export const browserHandle = v.object({
  providerSessionId: v.string(),
  cdpUrl: v.string(),
  interactiveLiveViewUrl: v.union(v.string(), v.null()),
  liveViewUrl: v.union(v.string(), v.null()),
  selectedTabId: v.optional(v.string()),
  currentUrl: v.union(v.string(), v.null()),
});

export const sessionUsage = agentsApiUsageValidator;

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
);
