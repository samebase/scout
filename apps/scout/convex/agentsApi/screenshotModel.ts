import { v } from "convex/values";
import { reviewChecksSchema } from "../../shared/reviewChecks";

export const reviewChecksValidator = v.array(
  v.object({
    label: v.string(),
    result: v.union(
      ...reviewChecksSchema.element.shape.result.options.map((result) => v.literal(result)),
    ),
    explanation: v.string(),
  }),
);

export const MAX_TASK_SCREENSHOTS = 20;
export const MAX_SCREENSHOT_NOTE_LENGTH = 600;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export const screenshotMetadata = v.object({
  tabId: v.string(),
  url: v.string(),
  title: v.string(),
  startedAtMs: v.number(),
  completedAtMs: v.number(),
  width: v.number(),
  height: v.number(),
  viewport: v.object({
    width: v.number(),
    height: v.number(),
    scrollX: v.number(),
    scrollY: v.number(),
  }),
});

export const screenshotState = v.union(
  v.object({ kind: v.literal("pending") }),
  v.object({ kind: v.literal("ready"), key: v.string(), metadata: screenshotMetadata }),
  v.object({ kind: v.literal("failed"), message: v.string() }),
);

export const screenshotRecord = v.object({
  sessionId: v.id("agentsApiSessions"),
  operationId: v.id("agentsApiBrowserOperations"),
  browserSequence: v.number(),
  operationSequence: v.number(),
  note: v.string(),
  state: screenshotState,
});

export const walkthroughContent = v.object({
  summary: v.string(),
  checks: v.optional(reviewChecksValidator),
  sections: v.array(
    v.object({
      heading: v.string(),
      explanation: v.string(),
      captureIds: v.array(v.id("agentsApiScreenshots")),
    }),
  ),
});

export const screenshotPresentation = screenshotRecord
  .pick("note", "browserSequence", "operationSequence")
  .extend({
    id: v.id("agentsApiScreenshots"),
    state: v.union(
      v.object({ kind: v.literal("pending") }),
      v.object({ kind: v.literal("ready"), metadata: screenshotMetadata }),
      v.object({ kind: v.literal("failed"), message: v.string() }),
    ),
  });
