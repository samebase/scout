import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_PRODUCT_URL_INPUT_LENGTH } from "./productsDomain";
import { projectClaims } from "./productsClaims";
import { productClaimSnapshotValidator } from "./productsModel";
import type { ProductInvestigationResult } from "./productsValidation";

export const MAX_EDITED_CLAIM_LENGTH = 1_200;
export const MAX_EDITED_TEST_INSTRUCTIONS_LENGTH = 1_200;

const CLAIM_KEY_PATTERN = /^claim-[a-z0-9]{10}(?:-[1-9][0-9]*)?$/;
const MAX_CLAIM_KEY_LENGTH = 64;
const MAX_CLAIM_EDITS_PER_INVESTIGATION = 20;

type DatabaseContext = Pick<QueryCtx, "db">;
type BaseClaim = ReturnType<typeof projectClaims>[number];
type ClaimSnapshot = Infer<typeof productClaimSnapshotValidator>;

export type ProjectedProductClaim = BaseClaim & {
  isEdited: boolean;
  editedAt: number | null;
};

export function routeClaimKey(value: string) {
  const claimKey = value.trim();
  return claimKey.length <= MAX_CLAIM_KEY_LENGTH && CLAIM_KEY_PATTERN.test(claimKey)
    ? claimKey
    : null;
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

export function requiredClaimStartingUrl(value: string, productDomain: string) {
  const input = requiredEditedClaimText(value, "Starting URL", MAX_PRODUCT_URL_INPUT_LENGTH);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Starting URL must be a valid URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Starting URL must use HTTP or HTTPS without credentials");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname !== productDomain && !hostname.endsWith(`.${productDomain}`)) {
    throw new Error(`Starting URL must belong to ${productDomain}`);
  }
  return url.href;
}

export function claimSnapshot(claim: {
  claim: string;
  sourceUrl: string;
  suggestedMysteryShop: string;
}): ClaimSnapshot {
  return {
    claim: claim.claim,
    sourceUrl: claim.sourceUrl,
    suggestedMysteryShop: claim.suggestedMysteryShop,
  };
}

export function claimSnapshotsMatch(left: ClaimSnapshot, right: ClaimSnapshot) {
  return (
    left.claim === right.claim &&
    left.sourceUrl === right.sourceUrl &&
    left.suggestedMysteryShop === right.suggestedMysteryShop
  );
}

export function runMatchesCurrentClaim(
  testedClaim: ClaimSnapshot | undefined,
  currentClaim: ProjectedProductClaim,
) {
  if (testedClaim) {
    return claimSnapshotsMatch(testedClaim, claimSnapshot(currentClaim));
  }
  return !currentClaim.isEdited;
}

export function applyClaimEdit(
  baseClaim: BaseClaim,
  edit: Doc<"productClaimEdits"> | null,
): ProjectedProductClaim {
  return edit
    ? {
        ...baseClaim,
        claim: edit.claim,
        sourceUrl: edit.sourceUrl,
        suggestedMysteryShop: edit.suggestedMysteryShop,
        isEdited: true,
        editedAt: edit.editedAt,
      }
    : {
        ...baseClaim,
        isEdited: false,
        editedAt: null,
      };
}

async function claimEdit(
  ctx: DatabaseContext,
  args: {
    userId: Id<"users">;
    productId: Id<"products">;
    investigationId: Id<"productInvestigations">;
    claimKey: string;
  },
) {
  return await ctx.db
    .query("productClaimEdits")
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
  const edits = await ctx.db
    .query("productClaimEdits")
    .withIndex("by_user_id_and_product_id_and_investigation_id_and_claim_key", (query) =>
      query
        .eq("userId", args.userId)
        .eq("productId", args.productId)
        .eq("investigationId", args.investigationId),
    )
    .take(MAX_CLAIM_EDITS_PER_INVESTIGATION);
  const editsByClaimKey = new Map(edits.map((edit) => [edit.claimKey, edit]));
  return projectClaims(args.claims).map((baseClaim) =>
    applyClaimEdit(baseClaim, editsByClaimKey.get(baseClaim.claimKey) ?? null),
  );
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
  },
) {
  const current = await findCurrentProductInvestigation(ctx, args.domain);
  if (!current) return null;
  const baseClaim = projectClaims(current.investigation.result.claims).find(
    (candidate) => candidate.claimKey === args.claimKey,
  );
  if (!baseClaim) return null;
  const edit = await claimEdit(ctx, {
    userId: args.userId,
    productId: current.product._id,
    investigationId: current.investigation._id,
    claimKey: baseClaim.claimKey,
  });
  return {
    ...current,
    baseClaim,
    edit,
    claim: applyClaimEdit(baseClaim, edit),
  };
}
