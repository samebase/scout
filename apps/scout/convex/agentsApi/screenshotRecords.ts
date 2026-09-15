import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { resolveViewer } from "../access";
import { readableSession } from "./access";
import {
  MAX_SCREENSHOT_NOTE_LENGTH,
  MAX_TASK_SCREENSHOTS,
  screenshotMetadata,
} from "./screenshotModel";

export async function taskScreenshots(
  ctx: Pick<QueryCtx, "db">,
  sessionId: Id<"agentsApiSessions">,
) {
  return await ctx.db
    .query("agentsApiScreenshots")
    .withIndex("by_session_id_and_browser_sequence_and_operation_sequence", (q) =>
      q.eq("sessionId", sessionId),
    )
    .order("asc")
    .take(MAX_TASK_SCREENSHOTS);
}

export const prepare = internalMutation({
  args: {
    sessionId: v.id("agentsApiSessions"),
    providerSessionId: v.string(),
    toolCallId: v.string(),
    note: v.string(),
  },
  returns: v.id("agentsApiScreenshots"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.state.kind !== "running") throw new Error("Task is no longer running");
    const note = args.note.trim();
    if (!note || note.length > MAX_SCREENSHOT_NOTE_LENGTH)
      throw new Error("Screenshot note is invalid");
    const browser = await ctx.db
      .query("agentsApiBrowserSessions")
      .withIndex("by_provider_session_id", (q) => q.eq("providerSessionId", args.providerSessionId))
      .unique();
    if (!browser || browser.agentsSessionId !== session._id || browser.lifecycle.kind !== "active")
      throw new Error("Browser does not belong to this active task");
    const operation = await ctx.db
      .query("agentsApiBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (q) =>
        q.eq("sessionId", browser._id).eq("toolCallId", args.toolCallId),
      )
      .unique();
    if (!operation || operation.state.kind !== "prepared")
      throw new Error("Browser operation is not in progress");
    const previous = await ctx.db
      .query("agentsApiScreenshots")
      .withIndex("by_operation_id", (q) => q.eq("operationId", operation._id))
      .unique();
    if (previous) throw new Error("A screenshot was already requested for this operation");
    if ((await taskScreenshots(ctx, session._id)).length >= MAX_TASK_SCREENSHOTS)
      throw new Error(
        `This task has reached its ${MAX_TASK_SCREENSHOTS}-screenshot limit. Continue without capturing.`,
      );
    return await ctx.db.insert("agentsApiScreenshots", {
      sessionId: session._id,
      operationId: operation._id,
      browserSequence: browser.sequence,
      operationSequence: operation.sequence,
      note,
      state: { kind: "pending" },
    });
  },
});

export const finish = internalMutation({
  args: {
    screenshotId: v.id("agentsApiScreenshots"),
    key: v.string(),
    metadata: screenshotMetadata,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.screenshotId);
    if (!capture || capture.state.kind !== "pending") throw new Error("Screenshot is not pending");
    await ctx.db.patch(capture._id, {
      state: { kind: "ready", key: args.key, metadata: args.metadata },
    });
    return null;
  },
});

export const fail = internalMutation({
  args: { screenshotId: v.id("agentsApiScreenshots"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.screenshotId);
    if (capture?.state.kind === "pending")
      await ctx.db.patch(capture._id, { state: { kind: "failed", message: args.message } });
    return null;
  },
});

export const imageKey = internalQuery({
  args: { screenshotId: v.id("agentsApiScreenshots") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.screenshotId);
    if (!capture || capture.state.kind !== "ready") return null;
    const session = await readableSession(ctx, capture.sessionId, await resolveViewer(ctx));
    return session ? capture.state.key : null;
  },
});
