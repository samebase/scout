import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  claimTestBrowserActionValidator,
  claimTestBrowserOperationStateValidator,
  claimTestBrowserSessionLifecycleValidator,
  claimTestBrowserViewportValidator,
} from "./claimTestBrowserModel";
import { productClaimSnapshotValidator, productInvestigationValidator } from "./productsModel";
import { productInvestigationActivityFieldsValidator } from "./productsInvestigationActivityModel";
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
    .index("by_status", ["status"])
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
  productInvestigationActivities: defineTable(productInvestigationActivityFieldsValidator.fields)
    .index("by_investigation_id_and_sequence", ["investigationId", "sequence"])
    .index("by_investigation_id_and_key", ["investigationId", "key"]),
  productInvestigationArtifacts: defineTable({
    investigationId: v.id("productInvestigations"),
    startedAt: v.number(),
    sequence: v.number(),
    url: v.string(),
    title: v.string(),
    markdown: v.string(),
    createdAt: v.number(),
  })
    .index("by_investigation_id_and_sequence", ["investigationId", "sequence"])
    .index("by_investigation_id_and_url", ["investigationId", "url"]),
  productClaimEdits: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    investigationId: v.id("productInvestigations"),
    claimKey: v.string(),
    claim: v.string(),
    // Kept during schema migration for edits written before sourceUrl became
    // read-only research evidence. Application projections ignore this field.
    sourceUrl: v.optional(v.string()),
    suggestedMysteryShop: v.string(),
    editedAt: v.number(),
  }).index("by_user_id_and_product_id_and_investigation_id_and_claim_key", [
    "userId",
    "productId",
    "investigationId",
    "claimKey",
  ]),
  productCustomClaims: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    claim: v.string(),
    suggestedMysteryShop: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  }).index("by_user_id_and_product_id", ["userId", "productId"]),
  productClaimHides: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    investigationId: v.id("productInvestigations"),
    claimKey: v.string(),
    hiddenAt: v.number(),
  }).index("by_user_id_and_product_id_and_investigation_id_and_claim_key", [
    "userId",
    "productId",
    "investigationId",
    "claimKey",
  ]),
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
  })
    .index("by_thread_id", ["threadId"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),
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
  claimTestRuns: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    investigationId: v.id("productInvestigations"),
    customClaimId: v.optional(v.id("productCustomClaims")),
    claimKey: v.string(),
    experimentId: v.id("scoutLabExperiments"),
    threadId: v.string(),
    scoutId: v.id("scouts"),
    generationId: v.id("scoutLabGenerations"),
    testedClaim: v.optional(productClaimSnapshotValidator),
  })
    .index("by_generation_id", ["generationId"])
    .index("by_user_id_and_product_id_and_investigation_id_and_claim_key", [
      "userId",
      "productId",
      "investigationId",
      "claimKey",
    ])
    .index("by_user_id_and_product_id_and_custom_claim_id", [
      "userId",
      "productId",
      "customClaimId",
    ]),
  claimTestBrowserSessions: defineTable({
    runId: v.id("claimTestRuns"),
    generationId: v.id("scoutLabGenerations"),
    userId: v.id("users"),
    provider: v.literal("firecrawl"),
    providerSessionId: v.string(),
    viewport: claimTestBrowserViewportValidator,
    nextOperationSequence: v.number(),
    lifecycle: claimTestBrowserSessionLifecycleValidator,
  })
    .index("by_run_id", ["runId"])
    .index("by_generation_id", ["generationId"])
    .index("by_provider_and_provider_session_id", ["provider", "providerSessionId"]),
  claimTestBrowserOperations: defineTable({
    sessionId: v.id("claimTestBrowserSessions"),
    runId: v.id("claimTestRuns"),
    sequence: v.number(),
    toolCallId: v.string(),
    action: claimTestBrowserActionValidator,
    state: claimTestBrowserOperationStateValidator,
  })
    .index("by_session_id_and_sequence", ["sessionId", "sequence"])
    .index("by_session_id_and_tool_call_id", ["sessionId", "toolCallId"]),
  claimTestLiveViews: defineTable({
    generationId: v.id("scoutLabGenerations"),
    runId: v.id("claimTestRuns"),
    userId: v.id("users"),
    liveViewUrl: v.string(),
    openedAt: v.number(),
  }).index("by_generation_id", ["generationId"]),
});
