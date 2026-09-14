import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { scoutActivity } from "./chatAccess";

export const availabilityValidator = v.union(
  v.literal("available"),
  v.literal("working"),
  v.literal("waiting"),
  v.literal("stopping"),
  v.literal("cleanup_failed"),
  v.literal("browser_open"),
);

export async function scoutReservation(ctx: QueryCtx, scoutId: Id<"scouts">) {
  const session = await ctx.db
    .query("agentsApiSessions")
    .withIndex("by_scout_id_and_active", (q) => q.eq("scoutId", scoutId).eq("active", true))
    .first();
  if (session) {
    const cleanup = session.cleanupJobId ? await ctx.db.system.get(session.cleanupJobId) : null;
    let status: Exclude<typeof availabilityValidator.type, "available">;
    switch (session.state.kind) {
      case "starting":
      case "running":
        status = "working";
        break;
      case "waiting":
        status = "waiting";
        break;
      case "idle":
      case "stopped":
      case "failed":
        status = cleanup?.state.kind === "failed" ? "cleanup_failed" : "stopping";
        break;
    }
    return { kind: "agents_api" as const, status, session };
  }

  const activity = await scoutActivity(ctx, scoutId);
  if (activity.kind !== "idle") {
    const status =
      activity.kind === "handoff"
        ? ("waiting" as const)
        : activity.kind === "stopping"
          ? activity.retryable
            ? ("cleanup_failed" as const)
            : ("stopping" as const)
          : ("working" as const);
    return { kind: "convex_agent" as const, status, threadId: activity.threadId };
  }

  for (const kind of ["closing", "active"] as const) {
    const browser = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
        q.eq("scoutId", scoutId).eq("lifecycle.kind", kind),
      )
      .first();
    if (browser) {
      return {
        kind: "browser" as const,
        status: kind === "closing" ? ("stopping" as const) : ("browser_open" as const),
        threadId: browser.threadId,
      };
    }
  }
  return null;
}
