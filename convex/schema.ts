import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  taskBrowserActionValidator,
  taskBrowserOperationStateValidator,
  taskBrowserSessionLifecycleValidator,
  taskBrowserViewportValidator,
} from "./taskBrowserModel";
import { taskHumanHandoffValidator } from "./taskHumanHandoffsModel";
import { taskBrowserProfileValidator } from "./taskAttemptModel";
import { productInvestigationValidator } from "./productsModel";
import { productInvestigationActivityFieldsValidator } from "./productsInvestigationActivityModel";
import { scoutServiceAccountFieldsValidator, scoutWebsiteIdentityValidator } from "./scout/model";
import { scoutModelValidator, scoutTurnStateValidator } from "./scout/models";

const taskServiceAccountProvenanceValidator = v.object({
  taskId: v.id("productTasks"),
  attemptId: v.id("taskAttempts"),
  turnId: v.id("scoutTurns"),
  sessionId: v.id("taskBrowserSessions"),
  recordedAt: v.number(),
  observedUrl: v.string(),
  visibleIdentity: v.string(),
  visibleSessionControl: v.string(),
  accountAccess: v.union(v.literal("created"), v.literal("recovered")),
});

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
  scoutServiceAccounts: defineTable(
    scoutServiceAccountFieldsValidator.extend({
      productId: v.id("products"),
      firstRecordedByTask: v.optional(taskServiceAccountProvenanceValidator),
      lastVerifiedByTask: v.optional(taskServiceAccountProvenanceValidator),
    }).fields,
  )
    .index("by_scout_id", ["scoutId"])
    .index("by_scout_id_and_service_domain", ["scoutId", "serviceDomain"])
    .index("by_product_id", ["productId"])
    .index("by_scout_id_and_service_domain_and_identifier", [
      "scoutId",
      "serviceDomain",
      "identifier",
    ]),
  scoutManagedCredentials: defineTable({
    credentialReference: v.string(),
    serviceAccountId: v.id("scoutServiceAccounts"),
    scoutId: v.id("scouts"),
    formatVersion: v.literal(1),
    algorithm: v.literal("aes-256-gcm"),
    keyVersion: v.literal(1),
    keyFingerprint: v.string(),
    credentialHost: v.string(),
    identifier: v.string(),
    nonce: v.string(),
    ciphertext: v.string(),
    authenticationTag: v.string(),
    createdAt: v.number(),
  })
    .index("by_credential_reference", ["credentialReference"])
    .index("by_service_account_id", ["serviceAccountId"]),
  scoutCredentialKeys: defineTable({
    keyVersion: v.literal(1),
    keyFingerprint: v.string(),
    createdAt: v.number(),
  }).index("by_key_version", ["keyVersion"]),
  scoutLabExperiments: defineTable({
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    name: v.string(),
    targetProduct: v.string(),
    targetDomain: v.string(),
    productId: v.id("products"),
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
  productTasks: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    instruction: v.string(),
  }).index("by_user_id_and_product_id", ["userId", "productId"]),
  taskAttempts: defineTable({
    taskId: v.id("productTasks"),
    scoutId: v.id("scouts"),
    threadId: v.string(),
    browserProfile: taskBrowserProfileValidator,
  })
    .index("by_task_id", ["taskId"])
    .index("by_thread_id", ["threadId"]),
  scoutTurns: defineTable({
    threadId: v.string(),
    order: v.number(),
    promptMessageId: v.string(),
    scoutId: v.id("scouts"),
    model: scoutModelValidator,
    startedAt: v.number(),
    state: scoutTurnStateValidator,
  })
    .index("by_prompt_message_id", ["promptMessageId"])
    .index("by_thread_id_and_order", ["threadId", "order"])
    .index("by_scout_id_and_state_kind", ["scoutId", "state.kind"]),
  taskBrowserSessions: defineTable({
    attemptId: v.id("taskAttempts"),
    turnId: v.id("scoutTurns"),
    sequence: v.number(),
    provider: v.literal("firecrawl"),
    providerSessionId: v.string(),
    profileName: v.union(v.string(), v.null()),
    viewport: taskBrowserViewportValidator,
    nextOperationSequence: v.number(),
    lifecycle: taskBrowserSessionLifecycleValidator,
  })
    .index("by_attempt_id_and_sequence", ["attemptId", "sequence"])
    .index("by_turn_id", ["turnId"])
    .index("by_provider_and_provider_session_id", ["provider", "providerSessionId"]),
  taskBrowserOperations: defineTable({
    sessionId: v.id("taskBrowserSessions"),
    sequence: v.number(),
    toolCallId: v.string(),
    action: taskBrowserActionValidator,
    state: taskBrowserOperationStateValidator,
  })
    .index("by_session_id_and_sequence", ["sessionId", "sequence"])
    .index("by_session_id_and_tool_call_id", ["sessionId", "toolCallId"]),
  taskLiveViews: defineTable({
    sessionId: v.id("taskBrowserSessions"),
    liveViewUrl: v.string(),
    openedAt: v.number(),
  }).index("by_session_id", ["sessionId"]),
  taskHumanHandoffs: defineTable(taskHumanHandoffValidator).index("by_session_id", ["sessionId"]),
});
