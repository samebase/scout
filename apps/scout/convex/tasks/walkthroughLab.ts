"use node";

import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { asSchema } from "@ai-sdk/provider-utils";
import { generateText, tool, type ToolSet } from "ai";
import { v } from "convex/values";
import { outdent } from "outdent";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { runtimeTools } from "./tools";
import { reportInstructions } from "./walkthroughReport";
import { walkthroughContent } from "./screenshotModel";
import { previousWalkthroughContext, TASK_INSTRUCTIONS } from "./instructions";
import { REVIEW_INSTRUCTIONS } from "../scout/review";
import { reviewChecksSchema } from "../../shared/reviewChecks";

const section = z.object({
  heading: z.string(),
  explanation: z.string(),
  captureIds: z.array(z.string()).min(1).max(3),
});

function edits<T extends z.ZodType>(value: T) {
  return z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("add"), value }),
      z.object({ kind: z.literal("update"), index: z.number().int().nonnegative(), value }),
      z.object({
        kind: z.literal("remove"),
        index: z.number().int().nonnegative(),
        reason: z.string(),
      }),
    ]),
  );
}

const patch = z.object({
  summary: z.string(),
  checks: edits(reviewChecksSchema.element),
  sections: edits(section),
});

// Temporary development experiment. It returns drafts and never saves a walkthrough.
export const compare = internalAction({
  args: {
    sessionId: v.id("agentsApiSessions"),
    mode: v.union(v.literal("current"), v.literal("reporter"), v.literal("edits")),
    previous: walkthroughContent,
    evidence: v.string(),
    model: v.union(v.literal("openai/gpt-5.6-luna"), v.literal("qwen/qwen3.7-flash")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, {
      sessionId: args.sessionId,
    });
    const resource = await runtimeTools(ctx, session, scout, "save_walkthrough", purpose);
    try {
      const original = resource.tools["save_walkthrough"];
      if (!original?.description) throw new Error("Walkthrough tool or description is missing");
      const previous = previousWalkthroughContext(args.previous);
      const instructions =
        args.mode === "current"
          ? outdent`
            ${TASK_INSTRUCTIONS}

            ${previous}

            ${REVIEW_INSTRUCTIONS}
          `
          : outdent`
            ${reportInstructions(args.previous)}

            ${
              args.mode === "edits"
                ? outdent`
              Submit only the checks and sections to add, update, or remove. Everything
              not mentioned remains unchanged. Indices refer to the zero-based position
              in the original previous report, before any edit. Update an existing finding
              when new evidence changes it. Remove only when it is superseded, duplicated,
              or the user explicitly removed that scope; give the reason. Rewrite the
              summary to describe the whole current report.
            `
                : ""
            }
          `;
      const startedAt = Date.now();
      const definition: ToolSet[string] =
        args.mode === "edits"
          ? tool({ description: "Edit the existing walkthrough.", inputSchema: patch })
          : tool({
              description: original.description,
              inputSchema: asSchema<unknown>(original.inputSchema),
            });
      const result = await generateText({
        model: convexGateway(args.model),
        instructions,
        messages: [{ role: "user", content: args.evidence }],
        tools: { save_walkthrough: definition },
        toolChoice: { type: "tool", toolName: "save_walkthrough" },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(240_000),
        ...(args.model === "openai/gpt-5.6-luna"
          ? { providerOptions: { convexGateway: { reasoningEffort: "max" } } }
          : {}),
      });
      return JSON.stringify({
        mode: args.mode,
        model: args.model,
        durationMs: Date.now() - startedAt,
        finishReason: result.finishReason,
        calls: result.toolCalls.map((call) => ({ name: call.toolName, input: call.input })),
        usage: result.usage,
      });
    } finally {
      await resource.dispose();
    }
  },
});
