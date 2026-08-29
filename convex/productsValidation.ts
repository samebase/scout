import type { Infer } from "convex/values";
import type { productInvestigationResultValidator } from "./productsModel";

const MAX_PROVIDER_FAILURE_LENGTH = 1_000;
const MAX_URL_LENGTH = 2_048;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_AUDIENCES = 5;
const MAX_AUDIENCE_LENGTH = 300;
const MAX_CLAIMS = 12;
const MAX_CLAIM_LENGTH = 1_200;
const MAX_SUPPORT_LENGTH = 2_000;
const MAX_MYSTERY_SHOP_LENGTH = 1_200;
const MAX_QUALIFIERS = 4;
const MAX_QUALIFIER_LENGTH = 400;
const MAX_EVIDENCE_EXCERPT_LENGTH = 280;
const MAX_PAGE_TITLE_LENGTH = 300;
const MAX_DEPENDENCIES = 8;
const MAX_DEPENDENCY_NAME_LENGTH = 200;
const MAX_RELATIONSHIP_LENGTH = 1_000;
const MAX_TENSIONS = 5;
const MAX_TENSION_LENGTH = 1_200;
const MIN_TENSION_EVIDENCE = 2;
const MAX_TENSION_EVIDENCE = 4;
const MAX_REQUIREMENTS = 5;
const MAX_REQUIREMENT_LENGTH = 600;
const MAX_UNKNOWNS = 8;
const MAX_UNKNOWN_LENGTH = 1_000;
const MAX_SOURCES = 12;

export type ProductInvestigationResult = Infer<typeof productInvestigationResultValidator>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} exceeds ${maximumLength} characters`);
  }
  return trimmed;
}

function optionalBoundedText(value: unknown, label: string, maximumLength: number) {
  if (value === undefined || value === null) return undefined;
  return boundedText(value, label, maximumLength);
}

function boundedArray(value: unknown, label: string, maximumLength: number, minimumLength = 0) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length < minimumLength || value.length > maximumLength) {
    throw new Error(`${label} must contain ${minimumLength}-${maximumLength} items`);
  }
  return value;
}

function firstPartyUrl(value: unknown, productDomain: string, label: string) {
  const input = boundedText(value, label, MAX_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(`${label} must be an HTTP or HTTPS URL without credentials`);
  }
  const sourceDomain = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (sourceDomain !== productDomain && !sourceDomain.endsWith(`.${productDomain}`)) {
    throw new Error(`${label} must belong to ${productDomain}`);
  }
  parsed.hash = "";
  return parsed.href;
}

function textArray(value: unknown, label: string, maximumItems: number, maximumItemLength: number) {
  return boundedArray(value, label, maximumItems).map((item, index) =>
    boundedText(item, `${label}[${index}]`, maximumItemLength),
  );
}

function accessResult(value: unknown): ProductInvestigationResult["access"] {
  const input = record(value, "Investigation access");
  const signupState = input["signupState"];
  if (
    signupState !== "open" &&
    signupState !== "waitlist" &&
    signupState !== "invite_only" &&
    signupState !== "unknown"
  ) {
    throw new Error("Investigation access.signupState is invalid");
  }
  const freeEntry = input["freeEntry"];
  if (
    freeEntry !== "yes" &&
    freeEntry !== "trial" &&
    freeEntry !== "no" &&
    freeEntry !== "unknown"
  ) {
    throw new Error("Investigation access.freeEntry is invalid");
  }
  const paymentMethodRequired = input["paymentMethodRequired"];
  if (
    paymentMethodRequired !== "yes" &&
    paymentMethodRequired !== "no" &&
    paymentMethodRequired !== "unknown"
  ) {
    throw new Error("Investigation access.paymentMethodRequired is invalid");
  }
  return {
    signupState,
    freeEntry,
    paymentMethodRequired,
    requirements: textArray(
      input["requirements"],
      "Investigation access.requirements",
      MAX_REQUIREMENTS,
      MAX_REQUIREMENT_LENGTH,
    ),
  };
}

function sourcesResult(value: unknown, productDomain: string) {
  const parsed = boundedArray(value, "Investigation sources", MAX_SOURCES, 1).map((item, index) => {
    const input = record(item, `Investigation sources[${index}]`);
    return {
      url: firstPartyUrl(input["url"], productDomain, `Investigation sources[${index}].url`),
      title: boundedText(
        input["title"],
        `Investigation sources[${index}].title`,
        MAX_PAGE_TITLE_LENGTH,
      ),
    };
  });
  const seen = new Set<string>();
  return parsed.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function citedUrl(
  value: unknown,
  productDomain: string,
  sourceUrls: ReadonlySet<string>,
  label: string,
) {
  const url = firstPartyUrl(value, productDomain, label);
  if (!sourceUrls.has(url)) {
    throw new Error(`${label} must appear in Investigation sources`);
  }
  return url;
}

function claimsResult(
  value: unknown,
  productDomain: string,
  sourceUrls: ReadonlySet<string>,
): ProductInvestigationResult["claims"] {
  return boundedArray(value, "Investigation claims", MAX_CLAIMS, 1).map((item, index) => {
    const input = record(item, `Investigation claims[${index}]`);
    const category = input["category"];
    if (
      category !== "capability" &&
      category !== "performance" &&
      category !== "pricing" &&
      category !== "privacy" &&
      category !== "security" &&
      category !== "integration" &&
      category !== "availability" &&
      category !== "comparison"
    ) {
      throw new Error(`Investigation claims[${index}].category is invalid`);
    }
    return {
      claim: boundedText(input["claim"], `Investigation claims[${index}].claim`, MAX_CLAIM_LENGTH),
      category,
      sourceUrl: citedUrl(
        input["sourceUrl"],
        productDomain,
        sourceUrls,
        `Investigation claims[${index}].sourceUrl`,
      ),
      support: boundedText(
        input["support"],
        `Investigation claims[${index}].support`,
        MAX_SUPPORT_LENGTH,
      ),
      suggestedMysteryShop: boundedText(
        input["suggestedMysteryShop"],
        `Investigation claims[${index}].suggestedMysteryShop`,
        MAX_MYSTERY_SHOP_LENGTH,
      ),
      qualifiers: textArray(
        input["qualifiers"],
        `Investigation claims[${index}].qualifiers`,
        MAX_QUALIFIERS,
        MAX_QUALIFIER_LENGTH,
      ),
      evidenceExcerpt:
        optionalBoundedText(
          input["evidenceExcerpt"],
          `Investigation claims[${index}].evidenceExcerpt`,
          MAX_EVIDENCE_EXCERPT_LENGTH,
        ) ?? null,
      pageTitle:
        optionalBoundedText(
          input["pageTitle"],
          `Investigation claims[${index}].pageTitle`,
          MAX_PAGE_TITLE_LENGTH,
        ) ?? null,
    };
  });
}

function dependenciesResult(
  value: unknown,
  productDomain: string,
  sourceUrls: ReadonlySet<string>,
): ProductInvestigationResult["dependencies"] {
  return boundedArray(value, "Investigation dependencies", MAX_DEPENDENCIES).map((item, index) => {
    const input = record(item, `Investigation dependencies[${index}]`);
    return {
      name: boundedText(
        input["name"],
        `Investigation dependencies[${index}].name`,
        MAX_DEPENDENCY_NAME_LENGTH,
      ),
      relationship: boundedText(
        input["relationship"],
        `Investigation dependencies[${index}].relationship`,
        MAX_RELATIONSHIP_LENGTH,
      ),
      sourceUrl: citedUrl(
        input["sourceUrl"],
        productDomain,
        sourceUrls,
        `Investigation dependencies[${index}].sourceUrl`,
      ),
    };
  });
}

function tensionsResult(
  value: unknown,
  productDomain: string,
  sourceUrls: ReadonlySet<string>,
): ProductInvestigationResult["tensions"] {
  return boundedArray(value, "Investigation tensions", MAX_TENSIONS).map((item, index) => {
    const input = record(item, `Investigation tensions[${index}]`);
    const evidence = boundedArray(
      input["evidence"],
      `Investigation tensions[${index}].evidence`,
      MAX_TENSION_EVIDENCE,
      MIN_TENSION_EVIDENCE,
    ).map((evidenceItem, evidenceIndex) => {
      const evidenceInput = record(
        evidenceItem,
        `Investigation tensions[${index}].evidence[${evidenceIndex}]`,
      );
      return {
        sourceUrl: citedUrl(
          evidenceInput["sourceUrl"],
          productDomain,
          sourceUrls,
          `Investigation tensions[${index}].evidence[${evidenceIndex}].sourceUrl`,
        ),
        evidenceExcerpt:
          optionalBoundedText(
            evidenceInput["evidenceExcerpt"],
            `Investigation tensions[${index}].evidence[${evidenceIndex}].evidenceExcerpt`,
            MAX_EVIDENCE_EXCERPT_LENGTH,
          ) ?? null,
        pageTitle:
          optionalBoundedText(
            evidenceInput["pageTitle"],
            `Investigation tensions[${index}].evidence[${evidenceIndex}].pageTitle`,
            MAX_PAGE_TITLE_LENGTH,
          ) ?? null,
      };
    });
    return {
      summary: boundedText(
        input["summary"],
        `Investigation tensions[${index}].summary`,
        MAX_TENSION_LENGTH,
      ),
      evidence,
    };
  });
}

export function parseProductInvestigationResult(
  value: unknown,
  productDomain: string,
): ProductInvestigationResult {
  const input = record(value, "Investigation result");
  const sources = sourcesResult(input["sources"], productDomain);
  const sourceUrls = new Set(sources.map((source) => source.url));
  return {
    summary: boundedText(input["summary"], "Investigation summary", MAX_SUMMARY_LENGTH),
    audiences: textArray(
      input["audiences"],
      "Investigation audiences",
      MAX_AUDIENCES,
      MAX_AUDIENCE_LENGTH,
    ),
    claims: claimsResult(input["claims"], productDomain, sourceUrls),
    dependencies: dependenciesResult(input["dependencies"], productDomain, sourceUrls),
    tensions: tensionsResult(input["tensions"], productDomain, sourceUrls),
    access: accessResult(input["access"]),
    unknowns: textArray(
      input["unknowns"],
      "Investigation unknowns",
      MAX_UNKNOWNS,
      MAX_UNKNOWN_LENGTH,
    ),
    sources,
  };
}

export function boundedInvestigationFailure(value: unknown) {
  const message = value instanceof Error ? value.message : "Product investigation failed";
  const trimmed = message.trim();
  return (trimmed || "Product investigation failed").slice(0, MAX_PROVIDER_FAILURE_LENGTH);
}
