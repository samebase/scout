import { v } from "convex/values";

export const polarEnvironmentValidator = v.union(v.literal("sandbox"), v.literal("production"));
export const creditPurchaseValidator = v.object({
  userId: v.id("users"),
  terms: v.object({
    policyVersion: v.string(),
    creditUnits: v.number(),
    priceCents: v.number(),
    currency: v.literal("usd"),
    productId: v.string(),
    organizationId: v.string(),
    environment: polarEnvironmentValidator,
  }),
  checkoutId: v.union(v.string(), v.null()),
  checkout: v.union(
    v.object({ kind: v.literal("creating") }),
    v.object({ kind: v.literal("ready"), url: v.string() }),
    v.object({ kind: v.literal("failed"), reason: v.string() }),
  ),
  orderId: v.union(v.string(), v.null()),
  customerId: v.union(v.string(), v.null()),
  paid: v.boolean(),
  // Older settled purchases paid the full stored price, before discounts were supported.
  paidProductCents: v.optional(v.number()),
  refundedProductCents: v.number(),
  refundedTaxCents: v.number(),
  creditedUnits: v.number(),
  fulfillment: v.union(
    v.object({ kind: v.literal("pending") }),
    v.object({ kind: v.literal("wallet") }),
    v.object({ kind: v.literal("manual_refund"), reason: v.string() }),
  ),
});

export const paidOrderEvidenceValidator = v.object({
  purchaseReference: v.string(),
  orderId: v.string(),
  checkoutId: v.string(),
  customerId: v.string(),
  organizationId: v.string(),
  productId: v.string(),
  environment: polarEnvironmentValidator,
  currency: v.string(),
  paid: v.boolean(),
  subtotalAmount: v.number(),
  discountAmount: v.number(),
  netAmount: v.number(),
  refundedProductAmount: v.number(),
  refundedTaxAmount: v.number(),
});
