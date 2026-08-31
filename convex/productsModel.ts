import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { selectableScoutModelValidator } from "./scout/models";

export const PRODUCT_INVESTIGATION_PROVIDER = "firecrawl-convex";
export const PRODUCT_INVESTIGATION_MODEL = "qwen/qwen3.7-flash";
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
  provider: v.literal(PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: selectableScoutModelValidator,
  effort: v.literal(PRODUCT_INVESTIGATION_EFFORT),
  maxCredits: v.number(),
  agentThreadId: v.string(),
  workflowId: v.optional(vWorkflowId),
};

const investigationBaseValidator = v.object(investigationIdentityFields);

export const queuedProductInvestigationValidator = investigationBaseValidator.extend({
  status: v.literal("queued"),
});

export const runningProductInvestigationValidator = investigationBaseValidator.extend({
  status: v.literal("running"),
  startedAt: v.number(),
  retrieval: v.optional(productRetrievalMetadataValidator),
});

export const completedProductInvestigationValidator = investigationBaseValidator.extend({
  status: v.literal("completed"),
  startedAt: v.number(),
  completedAt: v.number(),
  retrieval: productRetrievalMetadataValidator,
  result: productInvestigationResultValidator,
});

export const failedProductInvestigationValidator = investigationBaseValidator.extend({
  status: v.literal("failed"),
  startedAt: v.optional(v.number()),
  failedAt: v.number(),
  retrieval: v.optional(productRetrievalMetadataValidator),
  failure: v.string(),
});

export const productInvestigationValidator = v.union(
  queuedProductInvestigationValidator,
  runningProductInvestigationValidator,
  completedProductInvestigationValidator,
  failedProductInvestigationValidator,
);

const publicInvestigationFields = {
  _id: v.id("productInvestigations"),
  requestedAt: v.number(),
  provider: v.literal(PRODUCT_INVESTIGATION_PROVIDER),
  requestedModel: selectableScoutModelValidator,
  effort: v.literal(PRODUCT_INVESTIGATION_EFFORT),
  maxCredits: v.number(),
};

const queuedProductInvestigationPublicValidator = v.object({
  ...publicInvestigationFields,
  status: v.literal("queued"),
});

const runningProductInvestigationPublicValidator = v.object({
  ...publicInvestigationFields,
  status: v.literal("running"),
  startedAt: v.number(),
  stage: productInvestigationStageValidator,
  creditsUsed: v.union(v.number(), v.null()),
});

export const completedProductInvestigationPublicValidator = v.object({
  ...publicInvestigationFields,
  status: v.literal("completed"),
  startedAt: v.number(),
  completedAt: v.number(),
  creditsUsed: v.number(),
  result: productInvestigationResultValidator,
});

const failedProductInvestigationPublicValidator = v.object({
  ...publicInvestigationFields,
  status: v.literal("failed"),
  startedAt: v.union(v.number(), v.null()),
  failedAt: v.number(),
  creditsUsed: v.union(v.number(), v.null()),
  failure: v.string(),
});

export const productInvestigationPublicValidator = v.union(
  queuedProductInvestigationPublicValidator,
  runningProductInvestigationPublicValidator,
  completedProductInvestigationPublicValidator,
  failedProductInvestigationPublicValidator,
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
