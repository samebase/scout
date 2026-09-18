import { afterEach, expect, test, vi } from "vite-plus/test";
import { checkoutEnabled } from "./polarConfig";
import { polarCheckoutSchema, polarOrderRouteSchema, polarOrderSchema } from "./polarModel";

afterEach(() => vi.unstubAllEnvs());

test("checkout stays disabled until explicitly enabled", () => {
  vi.stubEnv("POLAR_CHECKOUT_ENABLED", undefined);
  expect(checkoutEnabled()).toBe(false);
  vi.stubEnv("POLAR_CHECKOUT_ENABLED", "false");
  expect(checkoutEnabled()).toBe(false);
  vi.stubEnv("POLAR_CHECKOUT_ENABLED", "true");
  expect(checkoutEnabled()).toBe(true);
});

test("checkout URL must be an HTTPS Polar host", () => {
  const checkout = {
    id: "checkout",
    url: "https://sandbox.polar.sh/checkout/checkout",
    organization_id: "organization",
    product_id: "product",
    external_customer_id: "user",
    amount: 500,
    currency: "usd",
    discount_amount: 0,
    is_payment_required: true,
    units: null,
    subscription_id: null,
    allow_discount_codes: false,
    tax_behavior: "exclusive",
    product: { is_recurring: false },
    product_price: { amount_type: "fixed", price_amount: 500, price_currency: "usd" },
  };
  expect(polarCheckoutSchema.parse(checkout).url).toBe(checkout.url);
  expect(() => polarCheckoutSchema.parse({ ...checkout, url: "javascript:alert(1)" })).toThrow();
  expect(() =>
    polarCheckoutSchema.parse({ ...checkout, url: "https://polar.sh.evil.test/checkout" }),
  ).toThrow();
});

test("order boundary rejects missing purchase references and negative refunds", () => {
  const order = {
    id: "order",
    checkout_id: "checkout",
    product_id: "product",
    customer_id: "customer",
    metadata: { scout_purchase_id: "purchase" },
    paid: true,
    billing_reason: "purchase",
    subscription_id: null,
    units: null,
    discount_amount: 0,
    applied_balance_amount: 0,
    currency: "usd",
    net_amount: 500,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    customer: { id: "customer", external_id: "user", organization_id: "organization" },
    product: { id: "product", organization_id: "organization", is_recurring: false },
  };
  expect(polarOrderSchema.parse(order).id).toBe("order");
  expect(() => polarOrderSchema.parse({ ...order, metadata: {} })).toThrow();
  expect(() => polarOrderSchema.parse({ ...order, refunded_amount: -1 })).toThrow();
  expect(polarOrderRouteSchema.parse({ product_id: "other-product", metadata: {} })).toMatchObject({
    product_id: "other-product",
  });
});
