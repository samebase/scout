import { v, type Infer } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { publicQuery } from "../functions";
import { readableSession } from "./access";
import { taskScreenshots } from "./screenshotRecords";
import { reviewChecksSchema } from "../../shared/reviewChecks";
import {
  MAX_TASK_SCREENSHOTS,
  screenshotPresentation,
  walkthroughContent,
  reviewChecksValidator,
} from "./screenshotModel";

export const get = publicQuery({
  access: "access_public",
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.union(
    v.object({
      walkthrough: v.union(walkthroughContent, v.null()),
      captures: v.array(screenshotPresentation),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await readableSession(ctx, args.sessionId, ctx.viewer);
    if (!session) return null;
    const captures = await taskScreenshots(ctx, session._id);
    return {
      walkthrough: session.walkthrough ?? null,
      captures: captures.map((capture) => ({
        id: capture._id,
        note: capture.note,
        browserSequence: capture.browserSequence,
        operationSequence: capture.operationSequence,
        state:
          capture.state.kind === "ready"
            ? { kind: "ready" as const, metadata: capture.state.metadata }
            : capture.state,
      })),
    };
  },
});

export const listForAgent = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.array(screenshotPresentation),
  handler: async (ctx, args) =>
    (await taskScreenshots(ctx, args.sessionId)).map((capture) => ({
      id: capture._id,
      note: capture.note,
      browserSequence: capture.browserSequence,
      operationSequence: capture.operationSequence,
      state:
        capture.state.kind === "ready"
          ? { kind: "ready" as const, metadata: capture.state.metadata }
          : capture.state,
    })),
});

export const walkthroughInput = v.object({
  sessionId: v.id("agentsApiSessions"),
  summary: v.string(),
  checks: reviewChecksValidator,
  sections: v.array(
    v.object({
      heading: v.string(),
      explanation: v.string(),
      captureIds: v.array(v.string()),
    }),
  ),
});

export async function saveWalkthrough(ctx: MutationCtx, args: Infer<typeof walkthroughInput>) {
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.state.kind !== "running") throw new Error("Task is no longer running");
  const checks = reviewChecksSchema.parse(args.checks);
  if (!args.summary.trim() || args.summary.length > 2000)
    throw new Error("Write a summary of at most 2000 characters");
  if (!args.sections.length || args.sections.length > MAX_TASK_SCREENSHOTS)
    throw new Error(`Include 1–${MAX_TASK_SCREENSHOTS} walkthrough sections`);
  const sections = [];
  for (const section of args.sections) {
    if (
      !section.heading.trim() ||
      section.heading.length > 120 ||
      !section.explanation.trim() ||
      section.explanation.length > 2000
    )
      throw new Error("Each section needs a heading and explanation within the tool limits");
    if (!section.captureIds.length || section.captureIds.length > 3)
      throw new Error("Each section needs 1–3 screenshots");
    const captureIds: Id<"agentsApiScreenshots">[] = [];
    for (const rawId of section.captureIds) {
      const id = ctx.db.normalizeId("agentsApiScreenshots", rawId);
      if (!id) throw new Error("Invalid screenshot ID");
      const capture = await ctx.db.get(id);
      if (!capture || capture.sessionId !== session._id || capture.state.kind !== "ready")
        throw new Error("Use only completed screenshots from this task");
      if (captureIds.includes(id)) throw new Error("Do not repeat a screenshot within a section");
      captureIds.push(id);
    }
    sections.push({
      heading: section.heading.trim(),
      explanation: section.explanation.trim(),
      captureIds,
    });
  }
  const walkthrough = { summary: args.summary.trim(), checks, sections };
  await ctx.db.patch(session._id, { walkthrough });
  return walkthrough;
}

export const save = internalMutation({
  args: walkthroughInput,
  returns: v.null(),
  handler: async (ctx, args) => {
    await saveWalkthrough(ctx, args);
    return null;
  },
});
