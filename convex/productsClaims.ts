import type { ProductInvestigationResult } from "./productsValidation";

const CLAIM_KEY_MODULUS = 36n ** 10n;
const CLAIM_KEY_MULTIPLIER = 131n;
const CLAIM_KEY_SEED = 5_381n;

function normalizedClaimIdentityPart(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function claimKeyBase(claim: ProductInvestigationResult["claims"][number]) {
  const identity = JSON.stringify(
    [
      claim.category,
      claim.sourceUrl,
      claim.claim,
      claim.support,
      claim.suggestedMysteryShop,
      claim.evidenceExcerpt ?? "",
      claim.pageTitle ?? "",
      [...claim.qualifiers].map(normalizedClaimIdentityPart).sort(),
    ].map((part) => (typeof part === "string" ? normalizedClaimIdentityPart(part) : part)),
  );
  let hash = CLAIM_KEY_SEED;
  for (const character of identity) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    hash = (hash * CLAIM_KEY_MULTIPLIER + BigInt(codePoint)) % CLAIM_KEY_MODULUS;
  }
  return `claim-${hash.toString(36).padStart(10, "0")}`;
}

export function projectClaims(claims: ProductInvestigationResult["claims"]) {
  const occurrences = new Map<string, number>();
  return claims.map((claim) => {
    const base = claimKeyBase(claim);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      ...claim,
      claimKey: occurrence === 1 ? base : `${base}-${occurrence}`,
    };
  });
}
