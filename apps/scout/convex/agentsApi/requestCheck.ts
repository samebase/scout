"use node";

import { v } from "convex/values";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { diagnosticMessage } from "../scout/lib/redaction";
import { openAIClient } from "./client";
import { readAgentsApiUsage } from "./cost";
import {
  REQUEST_CHECK_INSTRUCTIONS,
  requestCheckResult,
  requestCheckFinishedState,
} from "./requestCheckModel";

export const run = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }): Promise<boolean> => {
    const check = await ctx.runQuery(internal.agentsApi.requestChecks.get, { sessionId });
    const input = {
      model: check.model,
      instructions: REQUEST_CHECK_INSTRUCTIONS,
      input: check.prompt,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(requestCheckResult, "request_check") },
      max_output_tokens: 1_200,
      store: false,
    } satisfies ResponseCreateParamsNonStreaming;
    const startedAt = Date.now();
    const request = JSON.stringify(input);
    if (
      !(await ctx.runMutation(internal.agentsApi.requestChecks.start, {
        sessionId,
        request,
        startedAt,
      }))
    )
      return false;

    let response: string | null = null;
    let usage: ReturnType<typeof readAgentsApiUsage> = null;
    let state: typeof requestCheckFinishedState.type;
    try {
      await ctx.runQuery(internal.agentsApi.sessions.runtime, { sessionId });
      const output = await openAIClient().responses.create(input);
      response = JSON.stringify(output);
      usage = readAgentsApiUsage(output.usage ?? null);
      if (output.status !== "completed")
        throw new Error(`Request check ended with ${output.status}`);
      if (!output.output_text) throw new Error("Request check returned no decision");
      const result = requestCheckResult.parse(JSON.parse(output.output_text));
      state = {
        kind: "completed",
        startedAt,
        finishedAt: Date.now(),
        request,
        response,
        usage,
        result,
      };
    } catch (error) {
      state = {
        kind: "failed",
        startedAt,
        finishedAt: Date.now(),
        request,
        response,
        usage,
        error: `Request check failed: ${diagnosticMessage(error)}`,
      };
    }
    return await ctx.runMutation(internal.agentsApi.requestChecks.finish, { sessionId, state });
  },
});
