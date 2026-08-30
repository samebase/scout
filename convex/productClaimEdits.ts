import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { projectClaims } from "./productsClaims";
import {
  productClaimPublicValidator,
  productClaimSnapshotValidator,
  productCustomClaimPublicValidator,
  productGeneratedClaimPublicValidator,
} from "./productsModel";
import type { ProductInvestigationResult } from "./productsValidation";

export const MAX_EDITED_CLAIM_LENGTH = 1_200;
export const MAX_EDITED_TEST_INSTRUCTIONS_LENGTH = 1_200;
export const MAX_CUSTOM_CLAIMS_PER_PRODUCT = 50;

const GENERATED_CLAIM_KEY_PATTERN = /^claim-[a-z0-9]{10}(?:-[1-9][0-9]*)?$/;
const CUSTOM_CLAIM_KEY_PATTERN = /^custom-[A-Za-z0-9_-]+$/;
const CUSTOM_CLAIM_KEY_PREFIX = "custom-";
const MAX_CLAIM_KEY_LENGTH = 64;
const MAX_CLAIM_OVERRIDES_PER_INVESTIGATION = 20;

type DatabaseContext = Pick<QueryCtx, "db">;
type BaseClaim = ReturnType<typeof projectClaims>[number];
type ClaimSnapshot = Infer<typeof productClaimSnapshotValidator>;

export type ProjectedProductClaim = Infer<typeof productClaimPublicValidator>;
export type ProjectedCustomProductClaim = Infer<typeof productCustomClaimPublicValidator>;
export type ProjectedGeneratedProductClaim = Infer<typeof productGeneratedClaimPublicValidator>;

export function routeClaimKey(value: string) {
  const claimKey = value.trim();
  return claimKey.length <= MAX_CLAIM_KEY_LENGTH &&
    (GENERATED_CLAIM_KEY_PATTERN.test(claimKey) || CUSTOM_CLAIM_KEY_PATTERN.test(claimKey))
    ? claimKey
    : null;
}

export function customClaimRouteKey(customClaimId: Id<"productCustomClaims">) {
  return `${CUSTOM_CLAIM_KEY_PREFIX}${customClaimId}`;
}

export function customClaimIdForRoute(ctx: DatabaseContext, claimKey: string) {
  if (!claimKey.startsWith(CUSTOM_CLAIM_KEY_PREFIX)) return null;
  return ctx.db.normalizeId("productCustomClaims", claimKey.slice(CUSTOM_CLAIM_KEY_PREFIX.length));
}

export function requiredEditedClaimText(value: string, label: string, maximumLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (Array.from(trimmed).length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`);
  }
  return trimmed;
}

export function editedTestInstructions(value: string) {
  const trimmed = value.trim();
  if (Array.from(trimmed).length > MAX_EDITED_TEST_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `Test instructions must be ${MAX_EDITED_TEST_INSTRUCTIONS_LENGTH} characters or fewer`,
    );
  }
  return trimmed;
}

export function claimSnapshot(claim: {
  claim: string;
  suggestedMysteryShop: string;
}): ClaimSnapshot {
  return {
    claim: claim.claim,
    suggestedMysteryShop: claim.suggestedMysteryShop,
  };
}

export function claimSnapshotsMatch(left: ClaimSnapshot, right: ClaimSnapshot) {
  return left.claim === right.claim && left.suggestedMysteryShop === right.suggestedMysteryShop;
}

export function runMatchesCurrentClaim(
  testedClaim: ClaimSnapshot,
  currentClaim: ProjectedProductClaim,
) {
  return claimSnapshotsMatch(testedClaim, claimSnapshot(currentClaim));
}

export function applyClaimOverride(
  baseClaim: BaseClaim,
  override: Extract<Doc<"productClaimOverrides">, { kind: "edited" }> | null,
): ProjectedGeneratedProductClaim {
  const hasEditableChanges =
    override !== null &&
    (override.claim !== baseClaim.claim ||
      override.suggestedMysteryShop !== baseClaim.suggestedMysteryShop);
  return override && hasEditableChanges
    ? {
        ...baseClaim,
        origin: "generated",
        claim: override.claim,
        suggestedMysteryShop: override.suggestedMysteryShop,
        isEdited: true,
        editedAt: override.editedAt,
      }
    : {
        ...baseClaim,
        origin: "generated",
        isEdited: false,
        editedAt: null,
      };
}

export function projectCustomClaim(
  customClaim: Doc<"productCustomClaims">,
): ProjectedCustomProductClaim {
  return {
    origin: "custom",
    claimKey: customClaimRouteKey(customClaim._id),
    claim: customClaim.claim,
    category: "custom",
    suggestedMysteryShop: customClaim.suggestedMysteryShop,
    isEdited: customClaim.editedAt !== undefined,
    editedAt: customClaim.editedAt ?? null,
  };
}

async function claimOverride(
  ctx: DatabaseContext,
  args: {
    userId: Id<"users">;
    productId: Id<"products">;
    investigationId: Id<"productInvestigations">;
    claimKey: string;
  },
) {
  return await ctx.db
    .query("productClaimOverrides")
    .withIndex("by_user_id_and_product_id_and_investigation_id_and_claim_key", (query) =>
      query
        .eq("userId", args.userId)
        .eq("productId", args.productId)
        .eq("investigationId", args.investigationId)
        .eq("claimKey", args.claimKey),
    )
    .unique();
}

export async function projectClaimsForUser(
  ctx: DatabaseContext,
  args: {
    userId: Id<"users">;
    productId: Id<"products">;
    investigationId: Id<"productInvestigations">;
    claims: ProductInvestigationResult["claims"];
  },
) {
  const [overrides, customClaims] = await Promise.all([
    ctx.db
      .query("productClaimOverrides")
      .withIndex("by_user_id_and_product_id_and_investigation_id_and_claim_key", (query) =>
        query
          .eq("userId", args.userId)
          .eq("productId", args.productId)
          .eq("investigationId", args.investigationId),
      )
      .take(MAX_CLAIM_OVERRIDES_PER_INVESTIGATION),
    ctx.db
      .query("productCustomClaims")
      .withIndex("by_user_id_and_product_id", (query) =>
        query.eq("userId", args.userId).eq("productId", args.productId),
      )
      .take(MAX_CUSTOM_CLAIMS_PER_PRODUCT),
  ]);
  const overridesByClaimKey = new Map(overrides.map((override) => [override.claimKey, override]));
  const generatedClaims = projectClaims(args.claims).flatMap((baseClaim) => {
    const override = overridesByClaimKey.get(baseClaim.claimKey);
    if (override?.kind === "hidden") return [];
    return [applyClaimOverride(baseClaim, override ?? null)];
  });
  return [...generatedClaims, ...customClaims.map(projectCustomClaim)];
}

export async function findCurrentProductInvestigation(ctx: DatabaseContext, domain: string) {
  const product = await ctx.db
    .query("products")
    .withIndex("by_domain", (query) => query.eq("domain", domain))
    .unique();
  if (!product?.latestCompletedInvestigationId) return null;
  const investigation = await ctx.db.get(
    "productInvestigations",
    product.latestCompletedInvestigationId,
  );
  if (investigation?.status !== "completed" || investigation.productId !== product._id) {
    return null;
  }
  return { product, investigation };
}

export async function findCurrentProductClaim(
  ctx: DatabaseContext,
  args: {
    userId: Id<"users">;
    domain: string;
    claimKey: string;
    includeHiddenGenerated?: boolean;
  },
) {
  const current = await findCurrentProductInvestigation(ctx, args.domain);
  if (!current) return null;

  const customClaimId = customClaimIdForRoute(ctx, args.claimKey);
  if (customClaimId) {
    const customClaim = await ctx.db.get("productCustomClaims", customClaimId);
    if (
      !customClaim ||
      customClaim.userId !== args.userId ||
      customClaim.productId !== current.product._id
    ) {
      return null;
    }
    return {
      ...current,
      kind: "custom" as const,
      customClaim,
      claim: projectCustomClaim(customClaim),
    };
  }

  const baseClaim = projectClaims(current.investigation.result.claims).find(
    (candidate) => candidate.claimKey === args.claimKey,
  );
  if (!baseClaim) return null;
  const lookup = {
    userId: args.userId,
    productId: current.product._id,
    investigationId: current.investigation._id,
    claimKey: baseClaim.claimKey,
  };
  const override = await claimOverride(ctx, lookup);
  if (override?.kind === "hidden" && !args.includeHiddenGenerated) return null;
  return {
    ...current,
    kind: "generated" as const,
    baseClaim,
    override,
    claim: applyClaimOverride(baseClaim, override?.kind === "edited" ? override : null),
  };
}
