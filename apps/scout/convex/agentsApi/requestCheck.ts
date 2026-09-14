"use node";

import { v } from "convex/values";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { diagnosticMessage } from "../scout/lib/redaction";
import { openAIClient } from "./client";
import { readAgentsApiUsage } from "./cost";
import { captureHandoffEvidence } from "./handoffEvidence";
import {
  REQUEST_CHECK_INSTRUCTIONS,
  RESUME_CHECK_INSTRUCTIONS,
  requestCheckResult,
  resumeCheckResult,
  requestCheckFinishedState,
  checkCall,
} from "./requestCheckModel";

export const run = internalAction({
  args: { checkId: v.id("agentsApiRequestChecks") },
  returns: v.boolean(),
  handler: async (ctx, { checkId }): Promise<boolean> => {
    const check = await ctx.runQuery(internal.agentsApi.requestChecks.get, { checkId });
    let call: typeof checkCall.type | null = null;
    let state: typeof requestCheckFinishedState.type;
    try {
      const { session } = await ctx.runQuery(internal.agentsApi.sessions.runtime, {
        sessionId: check.sessionId,
      });
      let evidence = null;
      if (
        check.kind === "resume" &&
        session.state.kind === "checking" &&
        session.state.checkId === checkId
      ) {
        if (session.browser?.providerSessionId !== check.providerSessionId)
          throw new Error("The handoff browser is no longer available");
        evidence = await captureHandoffEvidence(session.browser.cdpUrl);
      }
      const input = {
        model: check.model,
        instructions:
          check.kind === "initial" ? REQUEST_CHECK_INSTRUCTIONS : RESUME_CHECK_INSTRUCTIONS,
        input:
          check.kind === "initial"
            ? check.prompt
            : JSON.stringify({
                originalRequest: check.prompt,
                handoff: check.handoff.message,
                browser: evidence,
              }),
        reasoning: { effort: "low" },
        text: {
          format:
            check.kind === "initial"
              ? zodTextFormat(requestCheckResult, "request_check")
              : zodTextFormat(resumeCheckResult, "resume_check"),
        },
        max_output_tokens: 1_200,
        store: false,
      } satisfies ResponseCreateParamsNonStreaming;
      const request = JSON.stringify(input);
      const startedAt = Date.now();
      if (
        !(await ctx.runMutation(internal.agentsApi.requestChecks.start, {
          checkId,
          request,
          startedAt,
          evidence,
        }))
      )
        return false;
      call = { request, startedAt, response: null, usage: null };
      const output = await openAIClient().responses.create(input);
      call.response = JSON.stringify(output);
      call.usage = readAgentsApiUsage(output.usage ?? null);
      if (output.status !== "completed") throw new Error(`Check ended with ${output.status}`);
      if (!output.output_text) throw new Error("Check returned no decision");
      const parsed: unknown = JSON.parse(output.output_text);
      state =
        check.kind === "initial"
          ? {
              kind: "completed",
              finishedAt: Date.now(),
              call,
              result: { kind: "initial", ...requestCheckResult.parse(parsed) },
            }
          : {
              kind: "completed",
              finishedAt: Date.now(),
              call,
              result: { kind: "resume", ...resumeCheckResult.parse(parsed) },
            };
    } catch (error) {
      state = {
        kind: "failed",
        finishedAt: Date.now(),
        call,
        error: `${check.kind === "initial" ? "Request" : "Resume"} check failed: ${diagnosticMessage(error)}`,
      };
    }
    return await ctx.runMutation(internal.agentsApi.requestChecks.finish, { checkId, state });
  },
});
