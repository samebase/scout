"use node";

import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { asSchema } from "@ai-sdk/provider-utils";
import { APICallError, generateText, tool } from "ai";
import { setTimeout as delay } from "node:timers/promises";
import { outdent } from "outdent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { reviewChecksSchema } from "../../shared/reviewChecks";
import { MAX_WALKTHROUGH_SECTIONS } from "./screenshotModel";
import { previousWalkthroughContext } from "./instructions";
import { generationUsage } from "./convexAgentModel";
import { diagnoseTaskFailure } from "./providerFailure";

export const walkthroughDraftSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  checks: reviewChecksSchema,
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(120),
        explanation: z.string().trim().min(1).max(2000),
        captureIds: z.array(z.string()).min(1).max(3),
      }),
    )
    .min(1)
    .max(MAX_WALKTHROUGH_SECTIONS),
});

export const walkthroughDescription = outdent`
  Save this task's illustrated result using existing screenshot IDs. Lead the summary
  with the requested outcome and what you verified, in one or two short sentences.
  Each section explains an observed step,
  result, or problem and references 1–3 screenshots from this task. The section order
  is the reading order. Omit repetitive setup and distinguish findings from assumptions.
  Select the fewest screenshots that substantiate the findings and explain necessary steps.
  Do not include every captured image or repeat an image without a distinct reason.
  Use fresh evidence for new findings; an older, unrelated screen is not proof of them.
  This replaces the previous walkthrough, so submit the complete cumulative report,
  not just the latest follow-up. Keep earlier findings unless evidence about the same
  behavior corrects them or the user explicitly asks to remove them or replace the
  review's scope. It does not end the task.

  Include 1–10 concrete checks of the requested behavior, each with a short explanation.
  Use passed for verified success, failed for an observed product failure, and untested
  for behavior you could not verify. A paywall, missing access, or a Scout/browser-service
  error leaves that behavior untested; it does not establish a product failure.
  Keep checks at the task level, such as saving a project or exporting a file.
  Do not count navigation, screenshots, or other setup as successful product checks.
`;

export function reportInstructions(previous: Doc<"agentsApiSessions">["walkthrough"]) {
  return outdent`
    Update the task's single current walkthrough from the previous report,
    the user's requests, and the observed evidence below. You are the reporting
    step after the browser work. Do not browse or perform any new actions.

    ${previousWalkthroughContext(previous)}

    The review covers the accumulated findings, not only the latest user request.
    Use findings from both the previous report and the new draft. A narrower draft or an
    omitted check is not evidence that an earlier issue was resolved. Keep unresolved
    failures and limitations when adding unrelated successful checks. Apply the same
    correction and explicit scope-change rules to findings supplied only in the draft.

    Judge whether the behavior covered by this review worked. Attempting or inspecting something
    is not a successful outcome. A missing product capability is a limitation, not a passed
    check merely because you confirmed it was missing. Distinguish an observed product
    failure from a task you could not verify because of access or an external service.
    Mark an unsupported capability untested and explain that the product does not offer it.
    Each check must answer whether a requested product outcome worked. A draft's check
    about performing an inspection is evidence for that outcome, not a separate passed
    result. Fold that evidence into the relevant outcome check instead of preserving
    a misleading success from the draft.
  `;
}

export class WalkthroughReportingError extends Error {
  constructor(cause: unknown) {
    super("Walkthrough reporting failed", { cause });
  }
}

export async function saveWalkthroughDraft(
  ctx: ActionCtx,
  session: Doc<"agentsApiSessions">,
  callId: string,
  draft: z.infer<typeof walkthroughDraftSchema>,
  abortSignal: AbortSignal | undefined,
) {
  const sessionId = session._id;
  const context = await ctx.runQuery(internal.tasks.walkthroughReports.context, { sessionId });
  if (!context.previous) {
    await ctx.runMutation(internal.tasks.walkthrough.save, { sessionId, ...draft });
    return draft;
  }
  const captureIds = [
    ...new Set(
      [...context.previous.sections, ...draft.sections].flatMap((section) => section.captureIds),
    ),
  ];
  const reportSchema = walkthroughDraftSchema.extend({
    sections: z
      .array(
        walkthroughDraftSchema.shape.sections.element.extend({
          captureIds: z.array(z.enum(captureIds)).min(1).max(3),
        }),
      )
      .min(1)
      .max(MAX_WALKTHROUGH_SECTIONS),
  });
  const model = "openai/gpt-5.6-luna";
  const request = {
    model,
    instructions: reportInstructions(context.previous),
    prompt: JSON.stringify({ userRequests: context.requests, draft }),
    tools: {
      save_walkthrough: {
        description: walkthroughDescription,
        inputSchema: await asSchema(reportSchema).jsonSchema,
        strict: true,
      },
    },
    toolChoice: { type: "tool", toolName: "save_walkthrough" } as const,
    providerOptions: { convexGateway: { reasoningEffort: "max" } },
    maxRetries: 0,
  };
  try {
    await ctx.runMutation(internal.tasks.walkthroughReports.start, {
      sessionId,
      callId,
      model,
      request: JSON.stringify(request),
      startedAt: Date.now(),
    });
  } catch (error) {
    throw new WalkthroughReportingError(error);
  }
  const stopped = new AbortController();
  const finished = new AbortController();
  const signal = AbortSignal.any([stopped.signal, abortSignal ?? AbortSignal.timeout(180_000)]);
  const watch = (async () => {
    try {
      while (!finished.signal.aborted) {
        await delay(1_000, undefined, { signal: finished.signal });
        const current = await ctx.runQuery(internal.tasks.sessions.cleanupResources, { sessionId });
        if (current.state.kind !== "running") {
          stopped.abort(new Error("Task stopped during walkthrough reporting"));
          return;
        }
      }
    } catch (error) {
      if (!finished.signal.aborted) stopped.abort(error);
    }
  })();
  let response: string | null = null;
  let usage: ReturnType<typeof generationUsage> = null;
  try {
    signal.throwIfAborted();
    const result = await generateText({
      ...request,
      model: convexGateway(model),
      tools: {
        save_walkthrough: tool({
          description: walkthroughDescription,
          inputSchema: reportSchema,
          strict: true,
        }),
      },
      abortSignal: signal,
    });
    response = JSON.stringify(
      result.response.body ?? { content: result.content, finishReason: result.finishReason },
    );
    const step = result.steps[0];
    if (step) usage = generationUsage(step.usage);
    if (!step || result.steps.length !== 1)
      throw new Error("Walkthrough reporting did not produce exactly one model step");
    signal.throwIfAborted();
    const call = result.toolCalls[0];
    if (result.toolCalls.length !== 1 || !call)
      throw new Error("Walkthrough reporting did not return one report");
    if (call.dynamic)
      throw call.error ?? new Error("Walkthrough reporting returned an unknown tool call");
    await ctx.runMutation(internal.tasks.walkthroughReports.finish, {
      sessionId,
      callId,
      response,
      usage,
      outcome: { kind: "completed", report: call.input },
    });
    return call.input;
  } catch (error) {
    const diagnostic = diagnoseTaskFailure(error, "advance", "convex_agent");
    const message = [
      diagnostic.message,
      diagnostic.httpStatus === undefined ? null : `HTTP ${diagnostic.httpStatus}`,
      diagnostic.providerCode === undefined ? null : `Code: ${diagnostic.providerCode}`,
      diagnostic.requestId === undefined ? null : `Request ID: ${diagnostic.requestId}`,
    ]
      .filter((value) => value != null)
      .join("\n");
    console.error("Walkthrough reporting failed", {
      sessionId,
      callId,
      diagnostic,
      ...(APICallError.isInstance(error)
        ? { method: "POST", path: new URL(error.url).pathname }
        : {}),
    });
    await ctx.runMutation(internal.tasks.walkthroughReports.finish, {
      sessionId,
      callId,
      response: response ?? (APICallError.isInstance(error) ? (error.responseBody ?? null) : null),
      usage,
      outcome: { kind: "failed", error: message },
    });
    throw new WalkthroughReportingError(error);
  } finally {
    finished.abort();
    await watch;
  }
}
