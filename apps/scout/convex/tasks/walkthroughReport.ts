"use node";

import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { generateText, tool } from "ai";
import { outdent } from "outdent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { reviewChecksSchema } from "../../shared/reviewChecks";
import { MAX_TASK_SCREENSHOTS } from "./screenshotModel";
import { previousWalkthroughContext } from "./instructions";

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
    .max(MAX_TASK_SCREENSHOTS),
});

export const walkthroughDescription = outdent`
  Save this task's illustrated result using existing screenshot IDs. Lead the summary
  with the requested outcome and what you verified, in one or two short sentences.
  Each section explains an observed step,
  result, or problem and references 1–3 screenshots from this task. The section order
  is the reading order. Omit repetitive setup and distinguish findings from assumptions.
  This replaces the previous walkthrough, so submit the complete updated report,
  retaining earlier findings that still apply. It does not end the task.

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

    Judge whether the user's requested behavior worked. Attempting or inspecting something
    is not a successful outcome. A missing product capability is a limitation, not a passed
    check merely because you confirmed it was missing. Distinguish an observed product
    failure from a task you could not verify because of access or an external service.
    Each check must answer whether a requested product outcome worked. A draft's check
    about performing an inspection is evidence for that outcome, not a separate passed
    result. Fold that evidence into the relevant outcome check instead of preserving
    a misleading success from the draft.
  `;
}

// Development prototype. Usage is logged, but production cost integration is not added yet.
export async function reviseWalkthroughDraft(
  ctx: ActionCtx,
  sessionId: Id<"agentsApiSessions">,
  draft: z.infer<typeof walkthroughDraftSchema>,
) {
  const context = await ctx.runQuery(internal.tasks.walkthroughLabRecords.context, { sessionId });
  if (!context.previous) return draft;
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
      .max(MAX_TASK_SCREENSHOTS),
  });
  const startedAt = Date.now();
  const result = await generateText({
    model: convexGateway("openai/gpt-5.6-luna"),
    instructions: reportInstructions(context.previous),
    prompt: JSON.stringify({ userRequests: context.requests, draft }),
    tools: {
      save_walkthrough: tool({
        description: walkthroughDescription,
        inputSchema: reportSchema,
        strict: true,
      }),
    },
    toolChoice: { type: "tool", toolName: "save_walkthrough" },
    providerOptions: { convexGateway: { reasoningEffort: "max" } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(240_000),
  });
  const call = result.toolCalls[0];
  if (result.toolCalls.length !== 1 || !call)
    throw new Error("Walkthrough reporting did not return one report");
  if (call.dynamic)
    throw call.error ?? new Error("Walkthrough reporting returned an unknown tool call");
  console.info("Development walkthrough reporting", {
    sessionId,
    durationMs: Date.now() - startedAt,
    usage: result.usage,
    previousChecks: context.previous.checks?.length ?? 0,
    draftChecks: draft.checks.length,
    savedChecks: call.input.checks.length,
  });
  return call.input;
}
