import { authTables } from "@convex-dev/auth/server";
import { sessionRecordingConsent } from "./sessionRecordingModel";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTaskModel } from "../shared/taskModels";
import { creditWalletValidator, creditEntryValidator, creditUsageInput } from "./creditsModel";
import { creditPurchaseValidator } from "./creditPurchasesModel";
import { requestCheckRecord } from "./tasks/requestCheckModel";
import { convexContextRecord } from "./tasks/convexAgentModel";
import { siteProfile, siteResearchRecord } from "./tasks/siteResearchModel";
import { screenshotRecord, walkthroughContent } from "./tasks/screenshotModel";
import { walkthroughReporting } from "./tasks/walkthroughReportModel";
import { vWorkflowId } from "@convex-dev/workflow";
import {
  browserActionValidator,
  browserClickCaptureValidator,
  browserOperationStateValidator,
  browserSessionLifecycleValidator,
  browserViewportValidator,
  persistedBrowserSessionLifecycleValidator,
} from "./browserModel";
import { humanHandoffDeliveryRecordValidator } from "./humanHandoffDeliveryModel";
import { humanHandoffValidator } from "./humanHandoffsModel";
import { handoffAccess } from "./tasks/handoffModel";
import { scoutServiceAccountFieldsValidator, scoutWebsiteIdentityValidator } from "./scout/model";
import { browserProfileSummary } from "./scout/browserProfileModel";
import { activeSkillsValidator } from "./scout/skills";
import {
  chatPurposeValidator,
  chatVisibilityValidator,
  chatRuntimeValidator,
} from "./scout/chatModel";
import {
  compactionFields,
  modelCallPurposeValidator,
  scoutModelCallStateValidator,
  scoutModelSelectionValidator,
  scoutTurnStateValidator,
} from "./scout/models";
import { workspaceEntryValidator } from "./workspaceModel";
import { sitePreviewState } from "./scout/sitePreviewModel";
import {
  browserHandle,
  callResult,
  pendingMessage,
  sessionItem,
  sessionState,
  sessionUsage,
  taskEngine,
} from "./tasks/model";

const accountObservationFieldsValidator = v.object({
  threadId: v.string(),
  sessionId: v.id("scoutBrowserSessions"),
  recordedAt: v.number(),
  observedUrl: v.string(),
  accountAccess: v.union(v.literal("created"), v.literal("recovered")),
});

export const accountObservationValidator = v.union(
  accountObservationFieldsValidator.extend({
    kind: v.literal("agent_report"),
    operationId: v.id("scoutBrowserOperations"),
    verification: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("task_report"),
    taskSessionId: v.id("agentsApiSessions"),
    recordedAt: v.number(),
    observedUrl: v.string(),
    accountAccess: v.union(v.literal("created"), v.literal("recovered")),
    verification: v.string(),
  }),
  // Earlier observations remain readable in production.
  accountObservationFieldsValidator.extend({
    visibleIdentity: v.string(),
    visibleSessionControl: v.string(),
  }),
);

export const taskPreferences = v.object({
  lastTaskEngine: v.optional(taskEngine),
  lastConvexModel: v.optional(convexTaskModel),
  lastScoutId: v.optional(v.id("scouts")),
});

const userProfile = authTables.users.validator.extend({
  ...taskPreferences.fields,
  termsAcceptedAt: v.optional(v.number()),
  sessionRecordingConsent: v.optional(sessionRecordingConsent),
  isApproved: v.optional(v.boolean()),
  defaultScoutModelSelection: v.optional(scoutModelSelectionValidator),
});

const scoutTurnFields = {
  threadId: v.string(),
  order: v.number(),
  promptMessageId: v.string(),
  scoutId: v.id("scouts"),
  startedAt: v.number(),
  state: scoutTurnStateValidator,
};

const siteTask = v.object({ chatId: v.id("scoutChats"), createdAt: v.number() });

export default defineSchema({
  ...authTables,
  creditWallets: defineTable(creditWalletValidator).index("by_user_id", ["userId"]),
  creditEntries: defineTable(creditEntryValidator)
    .index("by_user_id", ["userId"])
    .index("by_source_key", ["sourceKey"]),
  creditUsageTotals: defineTable(creditUsageInput.extend({ chargedUnits: v.number() })).index(
    "by_source_key",
    ["sourceKey"],
  ),
  creditPurchases: defineTable(creditPurchaseValidator)
    .index("by_product_and_environment", ["terms.productId", "terms.environment"])
    .index("by_user_id", ["userId"])
    .index("by_order_id", ["orderId"]),
  taskConvexContexts: defineTable(convexContextRecord).index("by_session_id", ["sessionId"]),
  agentsApiSiteResearch: defineTable(siteResearchRecord).index("by_session_id", ["sessionId"]),
  agentsApiScreenshots: defineTable(screenshotRecord)
    .index("by_session_id_and_browser_sequence_and_operation_sequence", [
      "sessionId",
      "browserSequence",
      "operationSequence",
    ])
    .index("by_operation_id", ["operationId"]),
  agentsApiRequestChecks: defineTable(requestCheckRecord)
    .index("by_session_id", ["sessionId"])
    .index("by_session_id_and_kind", ["sessionId", "kind"]),
  agentsApiSessions: defineTable({
    // Existing managed sessions predate the engine selector.
    engine: v.optional(taskEngine),
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    scoutName: v.string(),
    title: v.string(),
    model: v.string(),
    state: sessionState,
    active: v.boolean(),
    providerId: v.optional(v.string()),
    previousTurnId: v.optional(v.string()),
    workflowId: v.optional(vWorkflowId),
    pendingMessage: v.optional(pendingMessage),
    cleanupJobId: v.optional(v.id("_scheduled_functions")),
    handoffEmailJobId: v.optional(v.id("_scheduled_functions")),
    handoffAccess: v.optional(handoffAccess),
    itemCursor: v.optional(v.string()),
    nextSequence: v.number(),
    browser: v.union(browserHandle, v.null()),
    usage: v.union(sessionUsage, v.null()),
    reportedModelUsd: v.optional(v.union(v.number(), v.null())),
    modelUsageIncomplete: v.optional(v.boolean()),
    billingEnabled: v.optional(v.boolean()),
    modelTurnId: v.optional(v.string()),
    // Current user request's capture attempts. Older tasks predate this counter.
    screenshotAttempts: v.optional(v.number()),
    walkthrough: v.optional(walkthroughContent),
  })
    .index("by_user_id", ["userId"])
    .index("by_scout_id_and_active", ["scoutId", "active"]),
  agentsApiItems: defineTable(
    sessionItem.extend({
      sessionId: v.id("agentsApiSessions"),
      sequence: v.number(),
    }),
  )
    .index("by_session_id_and_sequence", ["sessionId", "sequence"])
    .index("by_session_id_and_kind", ["sessionId", "kind"])
    .index("by_session_id_and_provider_item_id", ["sessionId", "providerItemId"]),
  agentsApiCalls: defineTable({
    sessionId: v.id("agentsApiSessions"),
    callId: v.string(),
    result: callResult,
    reporting: v.optional(walkthroughReporting),
  })
    .index("by_session_id_and_call_id", ["sessionId", "callId"])
    .index("by_session_id_and_reporting_started_at", ["sessionId", "reporting.startedAt"]),
  agentsApiBrowserSessions: defineTable({
    agentsSessionId: v.id("agentsApiSessions"),
    billable: v.optional(v.boolean()),
    sequence: v.number(),
    providerSessionId: v.string(),
    viewport: browserViewportValidator,
    lifecycle: browserSessionLifecycleValidator,
    nextOperationSequence: v.number(),
  })
    .index("by_agents_session_id_and_sequence", ["agentsSessionId", "sequence"])
    .index("by_provider_session_id", ["providerSessionId"]),
  agentsApiBrowserOperations: defineTable({
    sessionId: v.id("agentsApiBrowserSessions"),
    sequence: v.number(),
    toolCallId: v.string(),
    action: browserActionValidator,
    state: browserOperationStateValidator,
    clickCapture: v.union(browserClickCaptureValidator, v.null()),
  })
    .index("by_session_id_and_sequence", ["sessionId", "sequence"])
    .index("by_session_id_and_tool_call_id", ["sessionId", "toolCallId"]),
  users: defineTable(
    v.union(
      userProfile.extend({ state: v.optional(v.literal("active")) }),
      userProfile.extend({ state: v.literal("deleting"), workflowId: vWorkflowId }),
      v.object({ state: v.literal("deleted"), deletedAt: v.number() }),
    ),
  )
    .index("email", ["email"])
    .index("phone", ["phone"]),
  authVerifiers: defineTable(authTables.authVerifiers.validator)
    .index("signature", ["signature"])
    .index("sessionId", ["sessionId"]),
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
    browserProfileSummary: v.optional(browserProfileSummary),
  })
    .index("by_status", ["status"])
    .index("by_slug", ["slug"])
    .index("by_agent_mail_address", ["agentMail.address"])
    .index("by_agent_mail_inbox_id", ["agentMail.inboxId"])
    .index("by_firecrawl_profile_name", ["firecrawl.profileName"]),
  scoutServiceAccounts: defineTable(
    scoutServiceAccountFieldsValidator.extend({
      loginUpdatedAt: v.optional(v.number()),
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
    // Existing chats without a runtime belong to the Convex agent.
    runtime: v.optional(chatRuntimeValidator),
    threadId: v.string(),
    userId: v.id("users"),
    scoutId: v.id("scouts"),
    createdAt: v.number(),
    activeSkills: v.optional(activeSkillsValidator),
    modelSelection: v.optional(scoutModelSelectionValidator),
    purpose: chatPurposeValidator,
    visibility: chatVisibilityValidator,
    primarySite: v.optional(v.string()),
    // Absent until the manual site-directory backfill processes existing chats.
    publicSiteEligible: v.optional(v.boolean()),
    // Absent until syncChatSite has included this chat in the directory counters.
    siteCounted: v.optional(v.literal(true)),
  })
    .index("by_thread_id", ["threadId"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_public_site_eligible_and_created_at", ["publicSiteEligible", "createdAt"])
    .index("by_user_id_and_purpose_kind_and_created_at", ["userId", "purpose.kind", "createdAt"])
    .index("by_public_site_eligible_and_primary_site_and_created_at", [
      "publicSiteEligible",
      "primarySite",
      "createdAt",
    ])
    .index("by_user_id_and_purpose_kind_and_primary_site_and_created_at", [
      "userId",
      "purpose.kind",
      "primarySite",
      "createdAt",
    ]),
  sites: defineTable({
    hostname: v.string(),
    latestPublicTask: v.union(siteTask, v.null()),
    taskCount: v.number(),
    publicTaskCount: v.number(),
    preview: v.optional(sitePreviewState),
    profile: v.optional(siteProfile),
    researchId: v.optional(v.id("agentsApiSiteResearch")),
  })
    .index("by_hostname", ["hostname"])
    .index("by_latest_public_task_created_at_and_hostname", [
      "latestPublicTask.createdAt",
      "hostname",
    ]),
  siteUserListings: defineTable({
    userId: v.id("users"),
    hostname: v.string(),
    latestTask: siteTask,
    taskCount: v.number(),
  })
    .index("by_user_id_and_hostname", ["userId", "hostname"])
    .index("by_user_id_and_latest_task_created_at_and_hostname", [
      "userId",
      "latestTask.createdAt",
      "hostname",
    ]),
  scoutWorkspaces: defineTable(
    v.union(
      v.object({
        kind: v.literal("chat"),
        threadId: v.string(),
        cwd: v.string(),
        revision: v.number(),
      }),
      v.object({
        kind: v.literal("site"),
        site: v.string(),
        cwd: v.string(),
        revision: v.number(),
      }),
      v.object({
        kind: v.literal("agent_session"),
        sessionId: v.id("agentsApiSessions"),
        cwd: v.string(),
        revision: v.number(),
      }),
    ),
  )
    .index("by_thread_id", ["threadId"])
    .index("by_site", ["site"])
    .index("by_session_id", ["sessionId"]),
  scoutWorkspaceFiles: defineTable({
    workspaceId: v.id("scoutWorkspaces"),
    entry: workspaceEntryValidator,
  }).index("by_workspace_id_and_entry_path", ["workspaceId", "entry.path"]),
  scoutTurns: defineTable(
    v.union(
      scoutModelSelectionValidator.members[0].extend(scoutTurnFields),
      scoutModelSelectionValidator.members[1].extend(scoutTurnFields),
    ),
  )
    .index("by_prompt_message_id", ["promptMessageId"])
    .index("by_thread_id_and_order", ["threadId", "order"])
    .index("by_scout_id_and_state_kind", ["scoutId", "state.kind"]),
  scoutModelCalls: defineTable({
    turnId: v.id("scoutTurns"),
    purpose: v.optional(modelCallPurposeValidator),
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
  scoutCompactions: defineTable(compactionFields)
    .index("by_thread_id", ["threadId"])
    .index("by_model_call_id", ["modelCallId"]),
  scoutBrowserSessions: defineTable({
    threadId: v.string(),
    scoutId: v.id("scouts"),
    sequence: v.number(),
    provider: v.literal("firecrawl"),
    providerSessionId: v.string(),
    profileName: v.string(),
    viewport: browserViewportValidator,
    nextOperationSequence: v.number(),
    selectedTabId: v.optional(v.string()),
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
    clickCapture: v.optional(browserClickCaptureValidator),
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
    .index("by_turn_id", ["turnId"])
    .index("by_continuation_turn_id", ["continuationTurnId"]),
  scoutHumanHandoffDeliveries: defineTable(humanHandoffDeliveryRecordValidator).index(
    "by_handoff_id",
    ["handoffId"],
  ),
});
