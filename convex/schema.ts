import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  scoutBrowserStateValidator,
  scoutRunEventValidator,
  scoutRunStatusValidator,
} from "./scout/model";
import { scoutModelValidator, scoutTokenUsageValidator } from "./scout/models";

export default defineSchema({
  ...authTables,
  authEmailRateLimits: defineTable({
    key: v.string(),
    lastSentAt: v.number(),
  }).index("by_key", ["key"]),
  scouts: defineTable({
    displayName: v.string(),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    agentMail: v.object({
      inboxId: v.string(),
      address: v.string(),
    }),
    firecrawl: v.object({
      profileName: v.string(),
    }),
  })
    .index("by_slug", ["slug"])
    .index("by_agent_mail_address", ["agentMail.address"])
    .index("by_agent_mail_inbox_id", ["agentMail.inboxId"])
    .index("by_firecrawl_profile_name", ["firecrawl.profileName"]),
  scoutRuns: defineTable({
    scoutName: v.string(),
    scoutEmail: v.string(),
    scoutId: v.optional(v.id("scouts")),
    targetUrl: v.string(),
    mission: v.string(),
    status: scoutRunStatusValidator,
    browser: scoutBrowserStateValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_scout_id_and_created_at", ["scoutId", "createdAt"])
    .index("by_scout_email_and_scout_id_and_created_at", ["scoutEmail", "scoutId", "createdAt"]),
  scoutRunEvents: defineTable({
    runId: v.id("scoutRuns"),
    event: scoutRunEventValidator,
    createdAt: v.number(),
  }).index("by_run_id_and_created_at", ["runId", "createdAt"]),
  scoutLabThreads: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    createdAt: v.number(),
  }).index("by_thread_id", ["threadId"]),
  scoutLabGenerations: defineTable({
    threadId: v.string(),
    order: v.number(),
    promptMessageId: v.string(),
    scoutId: v.optional(v.id("scouts")),
    model: scoutModelValidator,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    failure: v.optional(v.string()),
    usage: v.optional(scoutTokenUsageValidator),
    firecrawlCredits: v.optional(v.number()),
    firecrawlDurationMs: v.optional(v.number()),
  })
    .index("by_prompt_message_id", ["promptMessageId"])
    .index("by_thread_id_and_order", ["threadId", "order"]),
});
