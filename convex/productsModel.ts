import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";

export const LEGACY_PRODUCT_INVESTIGATION_PROVIDER = "firecrawl-agent";
export const LEGACY_PRODUCT_INVESTIGATION_MODEL = "spark-2";
export const PRODUCT_INVESTIGATION_PROVIDER = "firecrawl-convex";
export const PRODUCT_INVESTIGATION_MODEL = "openai/gpt-5.6-luna";
export const PRODUCT_INVESTIGATION_EFFORT = "medium";
export const PRODUCT_INVESTIGATION_MAX_CREDITS = 9;

export const productClaimValidator = v.object({
  claim: v.string(),
  category: v.union(
    v.literal("capability"),
    v.literal("performance"),
    v.literal("pricing"),
    v.literal("privacy"),
    v.literal("security"),
    v.literal("integration"),
    v.literal("availability"),
    v.literal("comparison"),
  ),
  sourceUrl: v.string(),
  support: v.string(),
  suggestedMysteryShop: v.string(),
  qualifiers: v.array(v.string()),
  evidenceExcerpt: v.union(v.string(), v.null()),
  pageTitle: v.union(v.string(), v.null()),
});

export const productDependencyValidator = v.object({
  name: v.string(),
  relationship: v.string(),
  sourceUrl: v.string(),
});

export const productTensionEvidenceValidator = v.object({
  sourceUrl: v.string(),
  evidenceExcerpt: v.union(v.string(), v.null()),
  pageTitle: v.union(v.string(), v.null()),
});

export const productTensionValidator = v.object({
  summary: v.string(),
  evidence: v.array(productTensionEvidenceValidator),
});

export const productAccessValidator = v.object({
  signupState: v.union(
    v.literal("open"),
    v.literal("waitlist"),
    v.literal("invite_only"),
    v.literal("unknown"),
  ),
  freeEntry: v.union(v.literal("yes"), v.literal("trial"), v.literal("no"), v.literal("unknown")),
  paymentMethodRequired: v.union(v.literal("yes"), v.literal("no"), v.literal("unknown")),
  requirements: v.array(v.string()),
});

export const productSourceValidator = v.object({
  url: v.string(),
  title: v.string(),
});

export const productInvestigationResultValidator = v.object({
  summary: v.string(),
  audiences: v.array(v.string()),
  claims: v.array(productClaimValidator),
  dependencies: v.array(productDependencyValidator),
  tensions: v.array(productTensionValidator),
  access: productAccessValidator,
  unknowns: v.array(v.string()),
  sources: v.array(productSourceValidator),
});

export const productClaimPublicValidator = productClaimValidator.extend({
  claimKey: v.string(),
});

export const productInvestigationResultPublicValidator = productInvestigationResultValidator.extend(
  {
    claims: v.array(productClaimPublicValidator),
  },
);

export const productRetrievalMetadataValidator = v.object({
  mapCredits: v.number(),
  searchCredits: v.number(),
  scrapeCredits: v.number(),
  totalCredits: v.number(),
  mapCandidateCount: v.number(),
  selectedPageCount: v.number(),
  scrapedPageCount: v.number(),
});

export const productInvestigationStageValidator = v.union(
  v.literal("mapping"),
  v.literal("selecting"),
  v.literal("scraping"),
  v.literal("synthesizing"),
);

const investigationIdentityFields = {
  productId: v.id("products"),
  requestedByUserId: v.id("users"),
  requestedAt: v.number(),
  effort: v.literal(PRODUCT_INVESTIGATION_EFFORT),
  maxCredits: v.number(),
};

const legacyInvestigationBaseValidator = v.object({
  ...investigationIdentityFields,
  provider: v.literal(LEGACY_PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: v.literal(LEGACY_PRODUCT_INVESTIGATION_MODEL),
});

const currentInvestigationBaseValidator = v.object({
  ...investigationIdentityFields,
  provider: v.literal(PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: v.literal(PRODUCT_INVESTIGATION_MODEL),
  agentThreadId: v.string(),
  workflowId: v.optional(vWorkflowId),
});

export const legacyQueuedProductInvestigationValidator = legacyInvestigationBaseValidator.extend({
  status: v.literal("queued"),
});

export const legacyRunningProductInvestigationValidator = legacyInvestigationBaseValidator.extend({
  status: v.literal("running"),
  startedAt: v.number(),
  providerJobId: v.string(),
  pollCount: v.number(),
  creditsUsed: v.optional(v.number()),
  reportedModel: v.optional(v.string()),
  providerExpiresAt: v.optional(v.string()),
});

export const legacyCompletedProductInvestigationValidator = legacyInvestigationBaseValidator.extend(
  {
    status: v.literal("completed"),
    startedAt: v.number(),
    completedAt: v.number(),
    providerJobId: v.string(),
    creditsUsed: v.number(),
    reportedModel: v.optional(v.string()),
    providerExpiresAt: v.optional(v.string()),
    result: productInvestigationResultValidator,
  },
);

export const legacyFailedProductInvestigationValidator = legacyInvestigationBaseValidator.extend({
  status: v.literal("failed"),
  startedAt: v.optional(v.number()),
  failedAt: v.number(),
  providerJobId: v.optional(v.string()),
  creditsUsed: v.optional(v.number()),
  reportedModel: v.optional(v.string()),
  providerExpiresAt: v.optional(v.string()),
  failure: v.string(),
});

export const queuedProductInvestigationValidator = currentInvestigationBaseValidator.extend({
  status: v.literal("queued"),
});

export const runningProductInvestigationValidator = currentInvestigationBaseValidator.extend({
  status: v.literal("running"),
  startedAt: v.number(),
  retrieval: v.optional(productRetrievalMetadataValidator),
});

export const completedProductInvestigationValidator = currentInvestigationBaseValidator.extend({
  status: v.literal("completed"),
  startedAt: v.number(),
  completedAt: v.number(),
  retrieval: productRetrievalMetadataValidator,
  result: productInvestigationResultValidator,
});

export const failedProductInvestigationValidator = currentInvestigationBaseValidator.extend({
  status: v.literal("failed"),
  startedAt: v.optional(v.number()),
  failedAt: v.number(),
  retrieval: v.optional(productRetrievalMetadataValidator),
  failure: v.string(),
});

export const productInvestigationValidator = v.union(
  legacyQueuedProductInvestigationValidator,
  legacyRunningProductInvestigationValidator,
  legacyCompletedProductInvestigationValidator,
  legacyFailedProductInvestigationValidator,
  queuedProductInvestigationValidator,
  runningProductInvestigationValidator,
  completedProductInvestigationValidator,
  failedProductInvestigationValidator,
);

const publicIdentityFields = {
  _id: v.id("productInvestigations"),
  requestedAt: v.number(),
  effort: v.literal(PRODUCT_INVESTIGATION_EFFORT),
  maxCredits: v.number(),
};

const legacyPublicBase = {
  ...publicIdentityFields,
  provider: v.literal(LEGACY_PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: v.literal(LEGACY_PRODUCT_INVESTIGATION_MODEL),
};

const currentPublicBase = {
  ...publicIdentityFields,
  provider: v.literal(PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: v.literal(PRODUCT_INVESTIGATION_MODEL),
};

const queuedLegacyPublicValidator = v.object({
  ...legacyPublicBase,
  status: v.literal("queued"),
});

const queuedCurrentPublicValidator = v.object({
  ...currentPublicBase,
  status: v.literal("queued"),
});

const runningPublicFields = {
  status: v.literal("running"),
  startedAt: v.number(),
  providerJobId: v.union(v.string(), v.null()),
  pollCount: v.number(),
  creditsUsed: v.union(v.number(), v.null()),
  reportedModel: v.union(v.string(), v.null()),
  providerExpiresAt: v.union(v.string(), v.null()),
};

const runningLegacyPublicValidator = v.object({
  ...legacyPublicBase,
  ...runningPublicFields,
});

const runningCurrentPublicValidator = v.object({
  ...currentPublicBase,
  ...runningPublicFields,
  stage: productInvestigationStageValidator,
});

const completedPublicFields = {
  status: v.literal("completed"),
  startedAt: v.number(),
  completedAt: v.number(),
  providerJobId: v.union(v.string(), v.null()),
  creditsUsed: v.number(),
  reportedModel: v.union(v.string(), v.null()),
  providerExpiresAt: v.union(v.string(), v.null()),
  result: productInvestigationResultPublicValidator,
};

export const completedLegacyProductInvestigationPublicValidator = v.object({
  ...legacyPublicBase,
  ...completedPublicFields,
});

const completedCurrentProductInvestigationPublicValidator = v.object({
  ...currentPublicBase,
  ...completedPublicFields,
});

export const completedProductInvestigationPublicValidator = v.union(
  completedLegacyProductInvestigationPublicValidator,
  completedCurrentProductInvestigationPublicValidator,
);

const failedPublicFields = {
  status: v.literal("failed"),
  startedAt: v.union(v.number(), v.null()),
  failedAt: v.number(),
  providerJobId: v.union(v.string(), v.null()),
  creditsUsed: v.union(v.number(), v.null()),
  reportedModel: v.union(v.string(), v.null()),
  providerExpiresAt: v.union(v.string(), v.null()),
  failure: v.string(),
};

const failedLegacyPublicValidator = v.object({
  ...legacyPublicBase,
  ...failedPublicFields,
});

const failedCurrentPublicValidator = v.object({
  ...currentPublicBase,
  ...failedPublicFields,
});

export const productInvestigationPublicValidator = v.union(
  queuedLegacyPublicValidator,
  queuedCurrentPublicValidator,
  runningLegacyPublicValidator,
  runningCurrentPublicValidator,
  completedLegacyProductInvestigationPublicValidator,
  completedCurrentProductInvestigationPublicValidator,
  failedLegacyPublicValidator,
  failedCurrentPublicValidator,
);

export const scoutAccessSummaryValidator = v.object({
  scoutId: v.id("scouts"),
  displayName: v.string(),
  accountCount: v.number(),
  authenticationEvidence: v.union(v.literal("none"), v.literal("succeeded"), v.literal("failed")),
});

export const productListItemValidator = v.object({
  _id: v.id("products"),
  name: v.string(),
  domain: v.string(),
  primaryUrl: v.string(),
  scoutAccess: v.array(scoutAccessSummaryValidator),
  experimentCount: v.number(),
  latestInvestigation: v.union(productInvestigationPublicValidator, v.null()),
  latestCompletedInvestigation: v.union(completedProductInvestigationPublicValidator, v.null()),
});

export const productClaimRouteValidator = v.object({
  product: v.object({
    name: v.string(),
    domain: v.string(),
    primaryUrl: v.string(),
  }),
  claim: productClaimPublicValidator,
  completedAt: v.number(),
});
