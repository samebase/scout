import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAppUser } from "./access";
import { productResearchAgent } from "./productResearchAgent";
import {
  applyClaimOverride,
  claimSnapshot,
  claimSnapshotsMatch,
  customClaimRouteKey,
  editedTestInstructions,
  findCurrentProductClaim,
  findProductByDomain,
  MAX_CUSTOM_CLAIMS_PER_PRODUCT,
  MAX_EDITED_CLAIM_LENGTH,
  projectCustomClaim,
  projectCustomClaimsForUser,
  projectClaimsForUser,
  requiredEditedClaimText,
  routeClaimKey,
} from "./productClaimEdits";
import { productInvestigationWorkflow } from "./productInvestigationWorkflow";
import {
  canonicalProductDomain,
  ensureProduct,
  inferredProductName,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCTS,
  requiredProductText,
} from "./productsDomain";
import {
  LEGACY_PRODUCT_INVESTIGATION_MODEL,
  LEGACY_PRODUCT_INVESTIGATION_PROVIDER,
  PRODUCT_INVESTIGATION_EFFORT,
  PRODUCT_INVESTIGATION_MAX_CREDITS,
  PRODUCT_INVESTIGATION_MODEL,
  PRODUCT_INVESTIGATION_PROVIDER,
  productClaimPublicValidator,
  productClaimRouteValidator,
  productInvestigationResultValidator,
  productListItemValidator,
  productRetrievalMetadataValidator,
} from "./productsModel";
import { validateProductRetrievalMetadata } from "./productsResearch";
import { boundedInvestigationFailure, parseProductInvestigationResult } from "./productsValidation";
import type { SelectableScoutModel } from "./scout/models";

const MAX_ACCOUNTS_PER_PRODUCT = 200;
const MAX_EXPERIMENTS_PER_PRODUCT = 100;
const SYNC_BATCH_SIZE = 25;
const PRODUCT_RESEARCH_WATCHDOG_MS = 4 * 60 * 1_000;

const syncCursorValidator = v.object({
  phase: v.union(v.literal("accounts"), v.literal("experiments")),
  cursor: v.union(v.string(), v.null()),
});

type SyncCursor =
  | { phase: "accounts"; cursor: string | null }
  | { phase: "experiments"; cursor: string | null };

type SyncBatchResult = {
  accountsLinked: number;
  experimentsLinked: number;
  skipped: number;
  next: SyncCursor | null;
};

type AuthenticationEvidence = "none" | "succeeded" | "failed";

type CurrentInvestigation = Extract<
  Doc<"productInvestigations">,
  { provider: typeof PRODUCT_INVESTIGATION_PROVIDER }
>;

type LegacyInvestigation = Extract<
  Doc<"productInvestigations">,
  { provider: typeof LEGACY_PRODUCT_INVESTIGATION_PROVIDER }
>;

type RunningCurrentInvestigation = Extract<CurrentInvestigation, { status: "running" }>;

function routeProductDomain(value: string) {
  try {
    return canonicalProductDomain(value, "Product domain");
  } catch {
    return null;
  }
}

async function projectInvestigationResult(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  investigation: CompletedInvestigation,
) {
  return {
    ...investigation.result,
    claims: await projectClaimsForUser(ctx, {
      userId,
      productId: investigation.productId,
      investigationId: investigation._id,
      claims: investigation.result.claims,
    }),
  };
}

function isCurrentInvestigation(
  investigation: Doc<"productInvestigations">,
): investigation is CurrentInvestigation {
  return investigation.provider === PRODUCT_INVESTIGATION_PROVIDER;
}

function currentInvestigationStage(
  investigation: RunningCurrentInvestigation,
): "mapping" | "selecting" | "scraping" | "synthesizing" {
  if (investigation.retrieval === undefined) {
    return "mapping";
  }
  if (investigation.retrieval.selectedPageCount === 0) {
    return "selecting";
  }
  if (investigation.retrieval.scrapeCredits === 0) {
    return "scraping";
  }
  return "synthesizing";
}

function currentInvestigationBase(investigation: CurrentInvestigation) {
  return {
    productId: investigation.productId,
    requestedByUserId: investigation.requestedByUserId,
    requestedAt: investigation.requestedAt,
    provider: investigation.provider,
    requestedModel: investigation.requestedModel,
    effort: investigation.effort,
    maxCredits: investigation.maxCredits,
    agentThreadId: investigation.agentThreadId,
    ...(investigation.workflowId === undefined ? {} : { workflowId: investigation.workflowId }),
  };
}

function currentInvestigationPublicBase(investigation: CurrentInvestigation): {
  _id: Id<"productInvestigations">;
  requestedAt: number;
  provider: typeof PRODUCT_INVESTIGATION_PROVIDER;
  requestedModel: SelectableScoutModel;
  effort: typeof PRODUCT_INVESTIGATION_EFFORT;
  maxCredits: number;
} {
  return {
    _id: investigation._id,
    requestedAt: investigation.requestedAt,
    provider: PRODUCT_INVESTIGATION_PROVIDER,
    requestedModel: investigation.requestedModel,
    effort: investigation.effort,
    maxCredits: investigation.maxCredits,
  };
}

function legacyInvestigationPublicBase(investigation: LegacyInvestigation): {
  _id: Id<"productInvestigations">;
  requestedAt: number;
  provider: typeof LEGACY_PRODUCT_INVESTIGATION_PROVIDER;
  requestedModel: typeof LEGACY_PRODUCT_INVESTIGATION_MODEL;
  effort: typeof PRODUCT_INVESTIGATION_EFFORT;
  maxCredits: number;
} {
  return {
    _id: investigation._id,
    requestedAt: investigation.requestedAt,
    provider: LEGACY_PRODUCT_INVESTIGATION_PROVIDER,
    requestedModel: LEGACY_PRODUCT_INVESTIGATION_MODEL,
    effort: investigation.effort,
    maxCredits: investigation.maxCredits,
  };
}

type CompletedInvestigation = Extract<Doc<"productInvestigations">, { status: "completed" }>;

async function projectCompletedInvestigation(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  investigation: CompletedInvestigation,
) {
  const result = await projectInvestigationResult(ctx, userId, investigation);
  if (investigation.provider === PRODUCT_INVESTIGATION_PROVIDER) {
    return {
      ...currentInvestigationPublicBase(investigation),
      status: investigation.status,
      startedAt: investigation.startedAt,
      completedAt: investigation.completedAt,
      providerJobId: null,
      creditsUsed: investigation.retrieval.totalCredits,
      reportedModel: null,
      providerExpiresAt: null,
      result,
    };
  }
  return {
    ...legacyInvestigationPublicBase(investigation),
    status: investigation.status,
    startedAt: investigation.startedAt,
    completedAt: investigation.completedAt,
    providerJobId: investigation.providerJobId,
    creditsUsed: investigation.creditsUsed,
    reportedModel: investigation.reportedModel ?? null,
    providerExpiresAt: investigation.providerExpiresAt ?? null,
    result,
  };
}

async function projectInvestigation(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  investigation: Doc<"productInvestigations">,
) {
  switch (investigation.status) {
    case "queued":
      return investigation.provider === PRODUCT_INVESTIGATION_PROVIDER
        ? { ...currentInvestigationPublicBase(investigation), status: investigation.status }
        : { ...legacyInvestigationPublicBase(investigation), status: investigation.status };
    case "running":
      if (investigation.provider === PRODUCT_INVESTIGATION_PROVIDER) {
        return {
          ...currentInvestigationPublicBase(investigation),
          status: investigation.status,
          startedAt: investigation.startedAt,
          stage: currentInvestigationStage(investigation),
          providerJobId: null,
          pollCount: 0,
          creditsUsed: investigation.retrieval?.totalCredits ?? null,
          reportedModel: null,
          providerExpiresAt: null,
        };
      }
      return {
        ...legacyInvestigationPublicBase(investigation),
        status: investigation.status,
        startedAt: investigation.startedAt,
        providerJobId: investigation.providerJobId,
        pollCount: investigation.pollCount,
        creditsUsed: investigation.creditsUsed ?? null,
        reportedModel: investigation.reportedModel ?? null,
        providerExpiresAt: investigation.providerExpiresAt ?? null,
      };
    case "completed":
      return await projectCompletedInvestigation(ctx, userId, investigation);
    case "failed":
      if (investigation.provider === PRODUCT_INVESTIGATION_PROVIDER) {
        return {
          ...currentInvestigationPublicBase(investigation),
          status: investigation.status,
          startedAt: investigation.startedAt ?? null,
          failedAt: investigation.failedAt,
          providerJobId: null,
          creditsUsed: investigation.retrieval?.totalCredits ?? null,
          reportedModel: null,
          providerExpiresAt: null,
          failure: investigation.failure,
        };
      }
      return {
        ...legacyInvestigationPublicBase(investigation),
        status: investigation.status,
        startedAt: investigation.startedAt ?? null,
        failedAt: investigation.failedAt,
        providerJobId: investigation.providerJobId ?? null,
        creditsUsed: investigation.creditsUsed ?? null,
        reportedModel: investigation.reportedModel ?? null,
        providerExpiresAt: investigation.providerExpiresAt ?? null,
        failure: investigation.failure,
      };
  }
}

function latestAuthenticationEvidence(accounts: Doc<"scoutServiceAccounts">[]) {
  let state: AuthenticationEvidence = "none";
  let latestCheckedAt = -1;
  for (const account of accounts) {
    const evidence = account.authenticationEvidence;
    if (evidence.kind === "none" || evidence.checkedAt < latestCheckedAt) continue;
    state = evidence.kind;
    latestCheckedAt = evidence.checkedAt;
  }
  return state;
}

async function projectProduct(ctx: QueryCtx, product: Doc<"products">, userId: Id<"users">) {
  const [accounts, customClaims] = await Promise.all([
    ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_product_id", (q) => q.eq("productId", product._id))
      .take(MAX_ACCOUNTS_PER_PRODUCT),
    projectCustomClaimsForUser(ctx, { userId, productId: product._id }),
  ]);
  const accountsByScout = new Map<Id<"scouts">, Doc<"scoutServiceAccounts">[]>();
  for (const account of accounts) {
    const scoutAccounts = accountsByScout.get(account.scoutId) ?? [];
    scoutAccounts.push(account);
    accountsByScout.set(account.scoutId, scoutAccounts);
  }
  const scoutAccess = (
    await Promise.all(
      [...accountsByScout].map(async ([scoutId, scoutAccounts]) => {
        const scout = await ctx.db.get("scouts", scoutId);
        return scout
          ? {
              scoutId,
              displayName: scout.displayName,
              accountCount: scoutAccounts.length,
              authenticationEvidence: latestAuthenticationEvidence(scoutAccounts),
            }
          : null;
      }),
    )
  )
    .filter((access) => access !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  const experiments = await ctx.db
    .query("scoutLabExperiments")
    .withIndex("by_product_id_and_user_id", (q) =>
      q.eq("productId", product._id).eq("userId", userId),
    )
    .take(MAX_EXPERIMENTS_PER_PRODUCT);
  const latest = product.latestInvestigationId
    ? await ctx.db.get("productInvestigations", product.latestInvestigationId)
    : null;
  const latestCompleted =
    product.latestCompletedInvestigationId === product.latestInvestigationId
      ? latest
      : product.latestCompletedInvestigationId
        ? await ctx.db.get("productInvestigations", product.latestCompletedInvestigationId)
        : null;
  return {
    _id: product._id,
    name: product.name,
    domain: product.domain,
    primaryUrl: product.primaryUrl,
    customClaims,
    scoutAccess,
    experimentCount: experiments.length,
    latestInvestigation:
      latest && latest.productId === product._id
        ? await projectInvestigation(ctx, userId, latest)
        : null,
    latestCompletedInvestigation:
      latestCompleted?.status === "completed" && latestCompleted.productId === product._id
        ? await projectCompletedInvestigation(ctx, userId, latestCompleted)
        : null,
  };
}

async function syncAccountPage(ctx: MutationCtx, cursor: string | null): Promise<SyncBatchResult> {
  const page = await ctx.db.query("scoutServiceAccounts").paginate({
    cursor,
    numItems: SYNC_BATCH_SIZE,
  });
  let accountsLinked = 0;
  let skipped = 0;
  for (const account of page.page) {
    if (account.productId) continue;
    let name: string;
    let domain: string;
    try {
      name = requiredProductText(account.serviceName, "Product name", MAX_PRODUCT_NAME_LENGTH);
      domain = canonicalProductDomain(account.serviceDomain, "Service domain");
    } catch {
      skipped += 1;
      continue;
    }
    const product = await ensureProduct(ctx, { name, domain });
    await ctx.db.patch("scoutServiceAccounts", account._id, {
      productId: product.productId,
    });
    accountsLinked += 1;
  }
  if (!page.isDone) {
    return {
      accountsLinked,
      experimentsLinked: 0,
      skipped,
      next: { phase: "accounts", cursor: page.continueCursor },
    };
  }
  return {
    accountsLinked,
    experimentsLinked: 0,
    skipped,
    next: { phase: "experiments", cursor: null },
  };
}

async function syncExperimentPage(
  ctx: MutationCtx,
  cursor: string | null,
): Promise<SyncBatchResult> {
  const page = await ctx.db.query("scoutLabExperiments").paginate({
    cursor,
    numItems: SYNC_BATCH_SIZE,
  });
  let experimentsLinked = 0;
  let skipped = 0;
  for (const experiment of page.page) {
    if (experiment.productId) continue;
    let name: string;
    let domain: string;
    try {
      name = requiredProductText(experiment.targetProduct, "Product name", MAX_PRODUCT_NAME_LENGTH);
      domain = canonicalProductDomain(experiment.targetDomain, "Target domain");
    } catch {
      skipped += 1;
      continue;
    }
    const product = await ensureProduct(ctx, { name, domain });
    await ctx.db.patch("scoutLabExperiments", experiment._id, {
      productId: product.productId,
    });
    experimentsLinked += 1;
  }
  return {
    accountsLinked: 0,
    experimentsLinked,
    skipped,
    next: page.isDone ? null : { phase: "experiments", cursor: page.continueCursor },
  };
}

async function syncKnownProductsBatch(ctx: MutationCtx, state: SyncCursor) {
  return state.phase === "accounts"
    ? await syncAccountPage(ctx, state.cursor)
    : await syncExperimentPage(ctx, state.cursor);
}

async function activeInvestigationMatches(
  ctx: Pick<QueryCtx, "db">,
  investigation: Doc<"productInvestigations">,
) {
  const product = await ctx.db.get("products", investigation.productId);
  return product?.activeInvestigationId === investigation._id ? product : null;
}

export const list = query({
  args: {},
  returns: v.array(productListItemValidator),
  handler: async (ctx) => {
    const userId = await requireAppUser(ctx);
    const products = await ctx.db.query("products").withIndex("by_domain").take(MAX_PRODUCTS);
    const result = await Promise.all(
      products.map(async (product) => await projectProduct(ctx, product, userId)),
    );
    return result.sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const getByDomain = query({
  args: { domain: v.string() },
  returns: v.union(productListItemValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = routeProductDomain(args.domain);
    if (domain === null) return null;
    const product = await ctx.db
      .query("products")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    return product ? await projectProduct(ctx, product, userId) : null;
  },
});

export const getClaimByDomain = query({
  args: {
    domain: v.string(),
    claimKey: v.string(),
  },
  returns: v.union(productClaimRouteValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = routeProductDomain(args.domain);
    const claimKey = routeClaimKey(args.claimKey);
    if (domain === null || claimKey === null) return null;
    const current = await findCurrentProductClaim(ctx, { userId, domain, claimKey });
    return current
      ? {
          product: {
            name: current.product.name,
            domain: current.product.domain,
            primaryUrl: current.product.primaryUrl,
          },
          claim: current.claim,
          completedAt: current.investigation?.completedAt ?? null,
        }
      : null;
  },
});

export const updateClaim = mutation({
  args: {
    domain: v.string(),
    claimKey: v.string(),
    claim: v.string(),
    suggestedMysteryShop: v.string(),
  },
  returns: productClaimPublicValidator,
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = canonicalProductDomain(args.domain, "Product domain");
    const claimKey = routeClaimKey(args.claimKey);
    if (claimKey === null) {
      throw new Error("Claim not found in the current completed investigation");
    }
    const current = await findCurrentProductClaim(ctx, { userId, domain, claimKey });
    if (!current) {
      throw new Error("Claim not found in the current completed investigation");
    }

    const nextSnapshot = {
      claim: requiredEditedClaimText(args.claim, "Claim", MAX_EDITED_CLAIM_LENGTH),
      suggestedMysteryShop: editedTestInstructions(args.suggestedMysteryShop),
    };

    if (current.kind === "custom") {
      if (claimSnapshotsMatch(nextSnapshot, claimSnapshot(current.claim))) {
        return current.claim;
      }
      const editedAt = Date.now();
      await ctx.db.patch("productCustomClaims", current.customClaim._id, {
        ...nextSnapshot,
        editedAt,
      });
      return projectCustomClaim({
        ...current.customClaim,
        ...nextSnapshot,
        editedAt,
      });
    }

    if (claimSnapshotsMatch(nextSnapshot, claimSnapshot(current.baseClaim))) {
      if (current.override) {
        await ctx.db.delete("productClaimOverrides", current.override._id);
      }
      return applyClaimOverride(current.baseClaim, null);
    }
    if (claimSnapshotsMatch(nextSnapshot, claimSnapshot(current.claim))) {
      return current.claim;
    }

    const editedAt = Date.now();
    const replacement = {
      kind: "edited" as const,
      userId,
      productId: current.product._id,
      investigationId: current.investigation._id,
      claimKey: current.baseClaim.claimKey,
      ...nextSnapshot,
      editedAt,
    };
    if (current.override) {
      await ctx.db.replace("productClaimOverrides", current.override._id, replacement);
    } else {
      await ctx.db.insert("productClaimOverrides", replacement);
    }
    return {
      ...current.baseClaim,
      origin: current.claim.origin,
      ...nextSnapshot,
      isEdited: true,
      editedAt,
    };
  },
});

export const createClaim = mutation({
  args: {
    domain: v.string(),
    claim: v.string(),
    suggestedMysteryShop: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = canonicalProductDomain(args.domain, "Product domain");
    const product = await findProductByDomain(ctx, domain);
    if (!product) throw new Error("Product not found");
    const existing = await ctx.db
      .query("productCustomClaims")
      .withIndex("by_user_id_and_product_id", (query) =>
        query.eq("userId", userId).eq("productId", product._id),
      )
      .take(MAX_CUSTOM_CLAIMS_PER_PRODUCT);
    if (existing.length >= MAX_CUSTOM_CLAIMS_PER_PRODUCT) {
      throw new Error(
        `A product can contain at most ${MAX_CUSTOM_CLAIMS_PER_PRODUCT} custom claims`,
      );
    }
    const now = Date.now();
    const customClaimId = await ctx.db.insert("productCustomClaims", {
      userId,
      productId: product._id,
      claim: requiredEditedClaimText(args.claim, "Claim", MAX_EDITED_CLAIM_LENGTH),
      suggestedMysteryShop: editedTestInstructions(args.suggestedMysteryShop),
      createdAt: now,
    });
    return customClaimRouteKey(customClaimId);
  },
});

export const removeClaim = mutation({
  args: {
    domain: v.string(),
    claimKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = canonicalProductDomain(args.domain, "Product domain");
    const claimKey = routeClaimKey(args.claimKey);
    const current = claimKey
      ? await findCurrentProductClaim(ctx, {
          userId,
          domain,
          claimKey,
          includeHiddenGenerated: true,
        })
      : null;
    if (!current) {
      throw new Error("Claim not found in the current completed investigation");
    }
    if (current.kind === "custom") {
      await ctx.db.delete("productCustomClaims", current.customClaim._id);
      return null;
    }
    if (current.override?.kind === "hidden") return null;
    const replacement = {
      kind: "hidden" as const,
      userId,
      productId: current.product._id,
      investigationId: current.investigation._id,
      claimKey: current.baseClaim.claimKey,
      hiddenAt: Date.now(),
    };
    if (current.override) {
      await ctx.db.replace("productClaimOverrides", current.override._id, replacement);
    } else {
      await ctx.db.insert("productClaimOverrides", replacement);
    }
    return null;
  },
});

export const create = mutation({
  args: {
    url: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.object({
    productId: v.id("products"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const domain = canonicalProductDomain(args.url);
    return await ensureProduct(ctx, {
      name:
        args.name === undefined
          ? inferredProductName(domain)
          : requiredProductText(args.name, "Product name", MAX_PRODUCT_NAME_LENGTH),
      domain,
    });
  },
});

export const syncKnownProducts = mutation({
  args: {
    continuation: v.optional(syncCursorValidator),
  },
  returns: v.object({
    accountsLinked: v.number(),
    experimentsLinked: v.number(),
    skipped: v.number(),
    next: v.union(syncCursorValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const result: SyncBatchResult = await syncKnownProductsBatch(
      ctx,
      args.continuation ?? { phase: "accounts", cursor: null },
    );
    return {
      accountsLinked: result.accountsLinked,
      experimentsLinked: result.experimentsLinked,
      skipped: result.skipped,
      next: result.next,
    };
  },
});

export const startInvestigation = mutation({
  args: { productId: v.id("products") },
  returns: v.object({
    investigationId: v.id("productInvestigations"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const product = await ctx.db.get("products", args.productId);
    if (!product) {
      throw new Error("Product not found");
    }
    if (product.activeInvestigationId) {
      const active = await ctx.db.get("productInvestigations", product.activeInvestigationId);
      if (active?.status === "queued" || active?.status === "running") {
        return { investigationId: active._id, created: false };
      }
    }

    const { threadId } = await productResearchAgent.createThread(ctx, {
      userId,
      title: `${product.name} product research`,
    });
    const investigationId = await ctx.db.insert("productInvestigations", {
      productId: product._id,
      requestedByUserId: userId,
      requestedAt: Date.now(),
      provider: PRODUCT_INVESTIGATION_PROVIDER,
      requestedModel: PRODUCT_INVESTIGATION_MODEL,
      effort: PRODUCT_INVESTIGATION_EFFORT,
      maxCredits: PRODUCT_INVESTIGATION_MAX_CREDITS,
      agentThreadId: threadId,
      status: "queued",
    });
    const workflowId = await productInvestigationWorkflow.start(
      ctx,
      internal.productsInvestigationWorkflow.productResearchV1,
      { investigationId },
      {
        startAsync: true,
        onComplete: internal.productsInvestigationWorkflow.onComplete,
        context: { investigationId },
      },
    );
    await ctx.db.patch("productInvestigations", investigationId, { workflowId });
    await ctx.db.patch("products", product._id, {
      activeInvestigationId: investigationId,
      latestInvestigationId: investigationId,
    });
    return { investigationId, created: true };
  },
});

export const resetResearch = mutation({
  args: { productId: v.id("products") },
  returns: v.object({ reset: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const product = await ctx.db.get("products", args.productId);
    if (!product) {
      throw new Error("Product not found");
    }

    if (product.activeInvestigationId) {
      const active = await ctx.db.get("productInvestigations", product.activeInvestigationId);
      if (active?.status === "queued" || active?.status === "running") {
        throw new Error("Wait for the active investigation to finish before resetting research");
      }
    }

    const reset =
      product.activeInvestigationId !== undefined ||
      product.latestInvestigationId !== undefined ||
      product.latestCompletedInvestigationId !== undefined;
    if (reset) {
      await ctx.db.patch("products", product._id, {
        activeInvestigationId: undefined,
        latestInvestigationId: undefined,
        latestCompletedInvestigationId: undefined,
      });
    }
    return { reset };
  },
});

export const markProductResearchRunning = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    durableWorkflow: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      productDomain: v.string(),
      productName: v.string(),
      primaryUrl: v.string(),
      agentThreadId: v.string(),
      startedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (
      !investigation ||
      investigation.status !== "queued" ||
      !isCurrentInvestigation(investigation)
    ) {
      return null;
    }
    const product = await activeInvestigationMatches(ctx, investigation);
    if (!product) return null;

    const startedAt = Date.now();
    await ctx.db.replace("productInvestigations", investigation._id, {
      ...currentInvestigationBase(investigation),
      status: "running",
      startedAt,
    });
    if (args.durableWorkflow !== true) {
      await ctx.scheduler.runAfter(
        PRODUCT_RESEARCH_WATCHDOG_MS,
        internal.products.watchdogProductResearch,
        { investigationId: investigation._id, startedAt },
      );
    }
    return {
      productDomain: product.domain,
      productName: product.name,
      primaryUrl: product.primaryUrl,
      agentThreadId: investigation.agentThreadId,
      startedAt,
    };
  },
});

export const isProductResearchActive = internalQuery({
  args: {
    investigationId: v.id("productInvestigations"),
    startedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (
      !investigation ||
      investigation.status !== "running" ||
      !isCurrentInvestigation(investigation) ||
      investigation.startedAt !== args.startedAt
    ) {
      return false;
    }
    return (await activeInvestigationMatches(ctx, investigation)) !== null;
  },
});

export const recordProductResearchRetrieval = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    startedAt: v.number(),
    retrieval: productRetrievalMetadataValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (
      !investigation ||
      investigation.status !== "running" ||
      !isCurrentInvestigation(investigation) ||
      investigation.startedAt !== args.startedAt
    ) {
      return false;
    }
    const product = await activeInvestigationMatches(ctx, investigation);
    if (!product) return false;
    const retrieval = validateProductRetrievalMetadata(args.retrieval);
    await ctx.db.patch("productInvestigations", investigation._id, { retrieval });
    return true;
  },
});

export const completeProductResearch = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    startedAt: v.number(),
    retrieval: productRetrievalMetadataValidator,
    result: productInvestigationResultValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (investigation?.status === "completed" && isCurrentInvestigation(investigation)) return true;
    if (
      !investigation ||
      investigation.status !== "running" ||
      !isCurrentInvestigation(investigation) ||
      investigation.startedAt !== args.startedAt
    ) {
      return false;
    }
    const product = await activeInvestigationMatches(ctx, investigation);
    if (!product) return false;
    const retrieval = validateProductRetrievalMetadata(args.retrieval);
    const result = parseProductInvestigationResult(args.result, product.domain);
    await ctx.db.replace("productInvestigations", investigation._id, {
      ...currentInvestigationBase(investigation),
      status: "completed",
      startedAt: investigation.startedAt,
      completedAt: Date.now(),
      retrieval,
      result,
    });
    await ctx.db.patch("products", product._id, {
      activeInvestigationId: undefined,
      latestCompletedInvestigationId: investigation._id,
    });
    return true;
  },
});

export const failProductResearch = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    failure: v.string(),
    retrieval: v.optional(productRetrievalMetadataValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (investigation?.status === "failed" && isCurrentInvestigation(investigation)) return true;
    if (
      !investigation ||
      !isCurrentInvestigation(investigation) ||
      (investigation.status !== "queued" && investigation.status !== "running")
    ) {
      return false;
    }
    const product = await activeInvestigationMatches(ctx, investigation);
    if (!product) return false;
    const retrieval =
      args.retrieval === undefined
        ? investigation.status === "running"
          ? investigation.retrieval
          : undefined
        : validateProductRetrievalMetadata(args.retrieval);
    const failedAt = Date.now();
    const failure = boundedInvestigationFailure(new Error(args.failure));
    const activities = await ctx.db
      .query("productInvestigationActivities")
      .withIndex("by_investigation_id_and_sequence", (query) =>
        query.eq("investigationId", investigation._id),
      )
      .take(32);
    for (const activity of activities) {
      if (activity.lifecycle.status !== "running") continue;
      await ctx.db.replace("productInvestigationActivities", activity._id, {
        investigationId: activity.investigationId,
        key: activity.key,
        sequence: activity.sequence,
        actor: activity.actor,
        operation: activity.operation,
        source: activity.source,
        lifecycle: {
          status: "failed",
          attempt: activity.lifecycle.attempt,
          startedAt: activity.lifecycle.startedAt,
          failedAt,
          failure,
        },
      });
    }
    await ctx.db.replace("productInvestigations", investigation._id, {
      ...currentInvestigationBase(investigation),
      status: "failed",
      ...(investigation.status === "running" ? { startedAt: investigation.startedAt } : {}),
      failedAt,
      ...(retrieval === undefined ? {} : { retrieval }),
      failure,
    });
    await ctx.db.patch("products", product._id, { activeInvestigationId: undefined });
    return true;
  },
});

export const watchdogProductResearch = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    startedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const investigation = await ctx.db.get("productInvestigations", args.investigationId);
    if (
      !investigation ||
      investigation.status !== "running" ||
      !isCurrentInvestigation(investigation) ||
      investigation.startedAt !== args.startedAt
    ) {
      return false;
    }
    const product = await activeInvestigationMatches(ctx, investigation);
    if (!product) return false;
    const remaining = investigation.startedAt + PRODUCT_RESEARCH_WATCHDOG_MS - Date.now();
    if (remaining > 0) {
      await ctx.scheduler.runAfter(remaining, internal.products.watchdogProductResearch, args);
      return false;
    }
    await ctx.db.replace("productInvestigations", investigation._id, {
      ...currentInvestigationBase(investigation),
      status: "failed",
      startedAt: investigation.startedAt,
      failedAt: Date.now(),
      ...(investigation.retrieval === undefined ? {} : { retrieval: investigation.retrieval }),
      failure: "Product investigation exceeded the four-minute limit",
    });
    await ctx.db.patch("products", product._id, { activeInvestigationId: undefined });
    return true;
  },
});
