// oxlint-disable-next-line no-restricted-imports -- This standalone demo exposes only synthetic public listings.
import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
export const list = query({
  args: {},
  returns: v.array(schema.doc("listings")),
  handler: async (ctx) => ctx.db.query("listings").withIndex("by_hostname").take(6),
});
export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const row of [
      { hostname: "alpha.example", title: "First server-rendered review" },
      { hostname: "beta.example", title: "Second server-rendered review" },
    ]) {
      const existing = await ctx.db
        .query("listings")
        .withIndex("by_hostname", (q) => q.eq("hostname", row.hostname))
        .unique();
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("listings", row);
    }
    return null;
  },
});
export const rename = internalMutation({
  args: { title: v.string() },
  returns: v.null(),
  handler: async (ctx, { title }) => {
    const row = await ctx.db
      .query("listings")
      .withIndex("by_hostname", (q) => q.eq("hostname", "alpha.example"))
      .unique();
    if (!row) throw new Error("Missing probe fixture");
    await ctx.db.patch(row._id, { title });
    return null;
  },
});
