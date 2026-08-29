import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { productInvestigationValidator } from "./productsModel";
import { scoutServiceAccountFieldsValidator, scoutWebsiteIdentityValidator } from "./scout/model";
import { scoutModelValidator, scoutTokenUsageValidator } from "./scout/models";

export default defineSchema({
  ...authTables,
  authEmailRateLimits: defineTable({
    key: v.string(),
    lastSentAt: v.number(),
  }).index("by_key", ["key"]),
  scouts: defineTable({
    displayName: v.string(),
    websiteIdentity: scoutWebsiteIdentityValidator,
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
  products: defineTable({
    name: v.string(),
    domain: v.string(),
    primaryUrl: v.string(),
    latestInvestigationId: v.optional(v.id("productInvestigations")),
    latestCompletedInvestigationId: v.optional(v.id("productInvestigations")),
    activeInvestigationId: v.optional(v.id("productInvestigations")),
  }).index("by_domain", ["domain"]),
  productInvestigations: defineTable(productInvestigationValidator)
    .index("by_product_id", ["productId"])
    .index("by_product_id_and_requested_at", ["productId", "requestedAt"]),
  scoutServiceAccounts: defineTable(
    scoutServiceAccountFieldsValidator.extend({
      productId: v.optional(v.id("products")),
    }).fields,
  )
    .index("by_scout_id", ["scoutId"])
    .index("by_product_id", ["productId"])
    .index("by_scout_id_and_service_domain_and_identifier", [
      "scoutId",
      "serviceDomain",
      "identifier",
    ]),
  scoutLabExperiments: defineTable({
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    name: v.string(),
    targetProduct: v.string(),
    targetDomain: v.string(),
    productId: v.optional(v.id("products")),
    objective: v.string(),
    status: v.union(v.literal("active"), v.literal("completed")),
  })
    .index("by_user_id", ["userId"])
    .index("by_product_id_and_user_id", ["productId", "userId"]),
  scoutLabThreads: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    experimentId: v.optional(v.id("scoutLabExperiments")),
    createdAt: v.number(),
  }).index("by_thread_id", ["threadId"]),
  scoutLabGenerations: defineTable({
    threadId: v.string(),
    order: v.number(),
    promptMessageId: v.string(),
    scoutId: v.id("scouts"),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    leaseExpiresAt: v.number(),
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
    .index("by_thread_id_and_order", ["threadId", "order"])
    .index("by_scout_id_and_status", ["scoutId", "status"]),
});
