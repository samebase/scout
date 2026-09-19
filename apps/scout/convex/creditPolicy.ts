import { z } from "zod";

export const CREDIT_POLICY = {
  version: "2026-09-20",
  unitsPerCredit: 10_000,
  microdollarsPerCredit: 10_000,
  signupCredits: 50,
  packCredits: 400,
  packPriceCents: 500,
  currency: "usd",
  hostedWebSearchMicrodollarsPerCall: 10_000,
} as const;

export function creditsEnabled() {
  return process.env["CREDITS_ENABLED"] === "true";
}

export function firecrawlCreditsEnabled() {
  return (
    z.enum(["true", "false"]).default("false").parse(process.env["FIRECRAWL_CREDITS_ENABLED"]) ===
    "true"
  );
}

export const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const signedInteger = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const providerQuantity = z.number().finite().nonnegative();

export function costMicrodollars(costUsd: number) {
  return decimalCeiling(costUsd, 1_000_000);
}

function decimalCeiling(quantity: number, multiplier: number) {
  const decimal = providerQuantity.parse(quantity).toString();
  const exponentAt = decimal.indexOf("e");
  const coefficient = exponentAt < 0 ? decimal : decimal.slice(0, exponentAt);
  const exponent = exponentAt < 0 ? 0 : Number(decimal.slice(exponentAt + 1));
  const pointAt = coefficient.indexOf(".");
  const fractionLength = pointAt < 0 ? 0 : coefficient.length - pointAt - 1;
  const digits =
    BigInt(coefficient.replace(".", "")) * BigInt(nonnegativeInteger.parse(multiplier));
  const places = fractionLength - exponent;
  const numerator = places < 0 ? digits * 10n ** BigInt(-places) : digits;
  const denominator = places > 0 ? 10n ** BigInt(places) : 1n;
  return nonnegativeInteger.parse(Number((numerator + denominator - 1n) / denominator));
}

export function costUnits(
  microdollars: number,
  terms: { unitsPerCredit: number; microdollarsPerCredit: number },
) {
  const denominator = BigInt(positiveInteger.parse(terms.microdollarsPerCredit));
  return nonnegativeInteger.parse(
    Number(
      (BigInt(nonnegativeInteger.parse(microdollars)) *
        BigInt(positiveInteger.parse(terms.unitsPerCredit)) +
        denominator -
        1n) /
        denominator,
    ),
  );
}
