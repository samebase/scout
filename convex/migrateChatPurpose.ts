import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// One-time deployment checkpoint before making purpose and visibility required.
export const run = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ count: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("scoutChats").paginate(args.paginationOpts);
    for (const chat of result.page) {
      await ctx.db.patch(chat._id, {
        purpose:
          chat.purpose ??
          (chat.play ? { kind: "play", step: chat.play.step } : { kind: "general" }),
        visibility: chat.visibility ?? "private",
        play: undefined,
      });
    }
    return {
      count: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
