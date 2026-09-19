"use node";

import { v } from "convex/values";
import { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { diagnosticMessage } from "../scout/lib/redaction";
import { openAIClient } from "./client";
import { readAgentsApiUsage } from "./cost";
import { captureHandoffEvidence } from "./handoffEvidence";
import { MAX_REQUEST_CHECK_OUTPUT_TOKENS } from "./requestCheckCredits";
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
    const check = await ctx.runQuery(internal.tasks.requestChecks.get, { checkId });
    if (check.state.kind !== "pending") return false;
    let call: typeof checkCall.type | null = null;
    let state: typeof requestCheckFinishedState.type;
    try {
      const { session, scout } = await ctx.runQuery(internal.tasks.sessions.runtime, {
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
                scout: { email: scout.agentMail.address },
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
        max_output_tokens: MAX_REQUEST_CHECK_OUTPUT_TOKENS,
        store: false,
      } satisfies ResponseCreateParamsNonStreaming;
      const request = JSON.stringify(input);
      const startedAt = Date.now();
      const client = openAIClient(session._id);
      if (
        !(await ctx.runMutation(internal.tasks.requestChecks.start, {
          checkId,
          request,
          startedAt,
          evidence,
        }))
      )
        return false;
      call = { request, startedAt, response: null, usage: null };
      const output = await client.responses.create(input);
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
      const detail =
        error instanceof APIError
          ? `${error.message}${error.code ? ` [code: ${error.code}]` : ""}${error.requestID ? ` [request_id: ${error.requestID}]` : ""}`
          : diagnosticMessage(error);
      state = {
        kind: "failed",
        finishedAt: Date.now(),
        call,
        error: `${check.kind === "initial" ? "Request" : "Resume"} check failed: ${detail}`,
      };
    }
    return await ctx.runMutation(internal.tasks.requestChecks.finish, { checkId, state });
  },
});
