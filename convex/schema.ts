import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  browserActionValidator,
  browserOperationStateValidator,
  browserViewportValidator,
  persistedBrowserSessionLifecycleValidator,
} from "./browserModel";
import { humanHandoffDeliveryRecordValidator } from "./humanHandoffDeliveryModel";
import { humanHandoffValidator } from "./humanHandoffsModel";
import { scoutServiceAccountFieldsValidator, scoutWebsiteIdentityValidator } from "./scout/model";
import {
  scoutModelCallStateValidator,
  scoutModelValidator,
  scoutTurnStateValidator,
} from "./scout/models";

export const accountObservationValidator = v.object({
  threadId: v.string(),
  sessionId: v.id("scoutBrowserSessions"),
  recordedAt: v.number(),
  observedUrl: v.string(),
  visibleIdentity: v.string(),
  visibleSessionControl: v.string(),
  accountAccess: v.union(v.literal("created"), v.literal("recovered")),
});

export default defineSchema({
  ...authTables,
  authEmailRateLimits: defineTable({ key: v.string(), lastSentAt: v.number() }).index("by_key", [
    "key",
  ]),
  scouts: defineTable({
    displayName: v.string(),
    websiteIdentity: scoutWebsiteIdentityValidator,
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    agentMail: v.object({ inboxId: v.string(), address: v.string() }),
    firecrawl: v.object({ profileName: v.string() }),
  })
    .index("by_status", ["status"])
    .index("by_slug", ["slug"])
    .index("by_agent_mail_address", ["agentMail.address"])
    .index("by_agent_mail_inbox_id", ["agentMail.inboxId"])
    .index("by_firecrawl_profile_name", ["firecrawl.profileName"]),
  scoutServiceAccounts: defineTable(
    scoutServiceAccountFieldsValidator.extend({
      lastObserved: v.optional(accountObservationValidator),
    }).fields,
  )
    .index("by_scout_id", ["scoutId"])
    .index("by_scout_id_and_service_domain", ["scoutId", "serviceDomain"])
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
  scoutChats: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    createdAt: v.number(),
  })
    .index("by_thread_id", ["threadId"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),
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
  scoutModelCalls: defineTable({
    turnId: v.id("scoutTurns"),
    sequence: v.number(),
    provider: v.string(),
    modelId: v.string(),
    startedAt: v.number(),
    messageCount: v.number(),
    toolCount: v.number(),
    compactedBrowserSnapshotCount: v.number(),
    serializedBytes: v.number(),
    snapshotStorageId: v.id("_storage"),
    state: scoutModelCallStateValidator,
  }).index("by_turn_id_and_sequence", ["turnId", "sequence"]),
  scoutBrowserSessions: defineTable({
    threadId: v.string(),
    scoutId: v.id("scouts"),
    sequence: v.number(),
    provider: v.literal("firecrawl"),
    providerSessionId: v.string(),
    profileName: v.string(),
    viewport: browserViewportValidator,
    nextOperationSequence: v.number(),
    lifecycle: persistedBrowserSessionLifecycleValidator,
  })
    .index("by_thread_id_and_sequence", ["threadId", "sequence"])
    .index("by_scout_id_and_lifecycle_kind", ["scoutId", "lifecycle.kind"])
    .index("by_provider_and_provider_session_id", ["provider", "providerSessionId"]),
  scoutBrowserOperations: defineTable({
    sessionId: v.id("scoutBrowserSessions"),
    sequence: v.number(),
    toolCallId: v.string(),
    action: browserActionValidator,
    state: browserOperationStateValidator,
  })
    .index("by_session_id_and_sequence", ["sessionId", "sequence"])
    .index("by_session_id_and_tool_call_id", ["sessionId", "toolCallId"]),
  scoutLiveViews: defineTable({
    sessionId: v.id("scoutBrowserSessions"),
    liveViewUrl: v.string(),
    openedAt: v.number(),
  }).index("by_session_id", ["sessionId"]),
  scoutHumanHandoffs: defineTable(humanHandoffValidator)
    .index("by_session_id", ["sessionId"])
    .index("by_turn_id", ["turnId"]),
  scoutHumanHandoffDeliveries: defineTable(humanHandoffDeliveryRecordValidator).index(
    "by_handoff_id",
    ["handoffId"],
  ),
});
