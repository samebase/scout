import { v } from "convex/values";
import { env, internalMutation, internalQuery } from "../_generated/server";
import { walkthroughContent } from "./screenshotModel";

function requireDevelopment() {
  if (env.CONVEX_CLOUD_URL !== "https://acoustic-cat-488.eu-west-1.convex.cloud") {
    throw new Error("This walkthrough experiment is restricted to acoustic-cat-488 development");
  }
}

export const context = internalQuery({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.object({
    previous: v.union(walkthroughContent, v.null()),
    requests: v.array(v.string()),
  }),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Task not found");
    const requests = await ctx.db
      .query("agentsApiItems")
      .withIndex("by_session_id_and_kind", (q) => q.eq("sessionId", sessionId).eq("kind", "user"))
      .take(101);
    if (requests.length > 100) throw new Error("Experiment is limited to 100 user messages");
    requests.sort((a, b) => a.sequence - b.sequence);
    return {
      previous: session.walkthrough ?? null,
      requests: requests.map((request) => request.text),
    };
  },
});

export const restoreFixtureReport = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), walkthrough: walkthroughContent },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireDevelopment();
    if (args.sessionId !== "s5795wy0khebeyta4qcdvvec058es82c")
      throw new Error("Not the development fixture task");
    const session = await ctx.db.get(args.sessionId);
    if (session?.state.kind !== "idle")
      throw new Error("Fixture task must be idle before resetting its report");
    await ctx.db.patch(args.sessionId, { walkthrough: args.walkthrough });
    return null;
  },
});
