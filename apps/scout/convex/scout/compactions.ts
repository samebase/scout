import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import schema from "../schema";
import { compactionFields } from "./models";

export const latest = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(schema.doc("scoutCompactions"), v.null()),
  handler: async (ctx, { threadId }) =>
    await ctx.db
      .query("scoutCompactions")
      .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first(),
});

export const save = internalMutation({
  args: compactionFields,
  returns: v.id("scoutCompactions"),
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.modelCallId);
    const turn = call && (await ctx.db.get(call.turnId));
    if (
      !call ||
      call.purpose?.kind !== "compaction" ||
      call.state.kind !== "completed" ||
      call.state.finishReason !== "stop" ||
      !turn ||
      turn.threadId !== args.threadId ||
      turn.state.kind !== "pending"
    )
      throw new Error("Active compaction call not found");
    const existing = await ctx.db
      .query("scoutCompactions")
      .withIndex("by_model_call_id", (q) => q.eq("modelCallId", args.modelCallId))
      .unique();
    if (existing) return existing._id;
    const previous = await ctx.db
      .query("scoutCompactions")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();
    if ((previous?._id ?? null) !== args.previousCompactionId) {
      throw new Error("Conversation summary changed during compaction");
    }
    const [boundary] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [args.coveredThrough.messageId],
    });
    if (
      !boundary ||
      boundary.threadId !== args.threadId ||
      boundary.status !== "success" ||
      boundary.order !== args.coveredThrough.order ||
      boundary.stepOrder !== args.coveredThrough.stepOrder ||
      boundary.order > turn.order ||
      (previous &&
        (boundary.order < previous.coveredThrough.order ||
          (boundary.order === previous.coveredThrough.order &&
            boundary.stepOrder <= previous.coveredThrough.stepOrder)))
    )
      throw new Error("Invalid conversation compaction boundary");
    if (
      !args.summary.trim() ||
      args.afterTokens >= args.beforeTokens ||
      args.coveredMessageCount <= (previous?.coveredMessageCount ?? 0)
    ) {
      throw new Error("Compaction must summarize new history and reduce context");
    }
    return await ctx.db.insert("scoutCompactions", args);
  },
});
