import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    sessionKey: v.string(),
    onEvent: v.string(),
    runKey: v.string(),
    providerId: v.union(v.string(), v.null()),
    previousTurnId: v.union(v.string(), v.null()),
    stopped: v.boolean(),
    generation: v.number(),
    revision: v.number(),
    syncJobId: v.union(v.id("_scheduled_functions"), v.null()),
    syncError: v.union(v.string(), v.null()),
    itemCursor: v.union(v.string(), v.null()),
    nextSequence: v.number(),
  })
    .index("by_sessionKey", ["sessionKey"])
    .index("by_providerId", ["providerId"]),
  webhooks: defineTable({
    eventId: v.string(),
    sessionId: v.id("sessions"),
    type: v.string(),
  }).index("by_eventId", ["eventId"]),
  submittedResults: defineTable({ sessionId: v.id("sessions"), callId: v.string() }).index(
    "by_sessionId_and_callId",
    ["sessionId", "callId"],
  ),
});
