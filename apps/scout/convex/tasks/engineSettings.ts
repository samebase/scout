import { v } from "convex/values";
import { mutation, publicQuery } from "../functions";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function agentsApiEnabled(ctx: Pick<QueryCtx | MutationCtx, "db">) {
  const settings = await ctx.db
    .query("taskEngineSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  return settings?.agentsApiEnabled ?? false;
}

export const get = publicQuery({
  access: "access_public",
  args: {},
  returns: v.boolean(),
  handler: agentsApiEnabled,
});

export const set = mutation({
  access: "access_lab",
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    const settings = await ctx.db
      .query("taskEngineSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (settings) await ctx.db.patch(settings._id, { agentsApiEnabled: enabled });
    else await ctx.db.insert("taskEngineSettings", { key: "global", agentsApiEnabled: enabled });
    return null;
  },
});
