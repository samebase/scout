import { z } from "zod";

const identifier = z.string().min(1).max(500);
const cents = z.number().int().nonnegative();

export const polarOrderRouteSchema = z.object({
  product_id: identifier,
  metadata: z.object({ scout_purchase_id: identifier.optional() }),
});

export const polarCheckoutSchema = z.object({
  id: identifier,
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"))
    );
  }),
  organization_id: identifier,
  product_id: identifier,
  external_customer_id: identifier,
  amount: cents,
  currency: z.literal("usd"),
  discount_amount: cents,
  net_amount: cents,
  is_payment_required: z.boolean(),
  units: z.null(),
  seats: z.null().optional(),
  subscription_id: z.null(),
  allow_discount_codes: z.literal(true),
  tax_behavior: z.union([z.literal("exclusive"), z.null()]),
  product: z.object({ is_recurring: z.literal(false) }),
  product_price: z.object({
    amount_type: z.literal("fixed"),
    price_amount: cents,
    price_currency: z.literal("usd"),
  }),
});

export const polarOrderSchema = z.object({
  id: identifier,
  checkout_id: identifier,
  product_id: identifier,
  customer_id: identifier,
  metadata: z.object({ scout_purchase_id: identifier }),
  paid: z.literal(true),
  billing_reason: z.literal("purchase"),
  subscription_id: z.null(),
  units: z.null(),
  seats: z.null().optional(),
  subtotal_amount: cents,
  discount_amount: cents,
  applied_balance_amount: z.literal(0),
  currency: z.literal("usd"),
  net_amount: cents,
  refunded_amount: cents,
  refunded_tax_amount: cents,
  customer: z.object({ id: identifier, organization_id: identifier }),
  product: z.object({
    id: identifier,
    organization_id: identifier,
    is_recurring: z.literal(false),
  }),
});
