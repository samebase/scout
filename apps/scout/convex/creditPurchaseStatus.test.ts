/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertTestAccount } from "./testing/accounts";

async function setup() {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  const { userId, purchaseId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "buyer@example.test" });
    const purchaseId = await ctx.db.insert("creditPurchases", {
      userId,
      terms: {
        policyVersion: "test",
        creditUnits: 2_000_000,
        priceCents: 500,
        currency: "usd",
        productId: "credit-pack",
        organizationId: "scout",
        environment: "sandbox",
      },
      checkoutId: "checkout-1",
      checkout: { kind: "ready", url: "https://sandbox.polar.sh/checkout/1" },
      orderId: null,
      customerId: null,
      paid: false,
      refundedProductCents: 0,
      refundedTaxCents: 0,
      creditedUnits: 0,
      fulfillment: { kind: "pending" },
    });
    return { userId, purchaseId };
  });
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  const owner = backend.withIdentity({ subject: `${userId}|session` });
  const status = () => owner.query(api.creditPurchases.status, { purchaseId });
  const pay = (refundedProductAmount: number, refundedTaxAmount: number) =>
    backend.mutation(internal.creditPurchases.processOrder, {
      purchaseReference: purchaseId,
      orderId: "order-1",
      checkoutId: "checkout-1",
      customerId: "customer-1",
      externalCustomerId: userId,
      organizationId: "scout",
      productId: "credit-pack",
      environment: "sandbox",
      currency: "usd",
      paid: true,
      subtotalAmount: 500,
      discountAmount: 0,
      netAmount: 500,
      refundedProductAmount,
      refundedTaxAmount,
    });
  return { backend, owner, userId, purchaseId, status, pay };
}

test("projects paid, partial and full refunds from the settled purchase", async () => {
  const t = await setup();
  expect(await t.status()).toBe("pending");
  await t.pay(0, 0);
  expect(await t.status()).toBe("paid");
  await t.pay(0, 25);
  expect(await t.status()).toBe("partially_refunded");
  await t.pay(250, 50);
  expect(await t.status()).toBe("partially_refunded");
  await t.pay(500, 100);
  expect(await t.status()).toBe("refunded");
  await t.pay(0, 0);
  expect(await t.status()).toBe("refunded");
});

test("keeps failed checkout and manual review distinct from pending payment", async () => {
  const t = await setup();
  await t.backend.run((ctx) =>
    ctx.db.patch(t.purchaseId, {
      checkout: { kind: "failed", reason: "Private provider diagnostic" },
    }),
  );
  expect(await t.status()).toBe("checkout_failed");
  await t.backend.run((ctx) =>
    ctx.db.patch(t.purchaseId, {
      paid: true,
      fulfillment: { kind: "manual_refund", reason: "Manual review evidence" },
    }),
  );
  expect(await t.status()).toBe("needs_review");
  await t.backend.run((ctx) => ctx.db.patch(t.purchaseId, { refundedProductCents: 500 }));
  expect(await t.status()).toBe("refunded");
});

test("does not expose another account's purchase or an invalid reference", async () => {
  const t = await setup();
  const otherId = await t.backend.run((ctx) =>
    insertTestAccount(ctx, { email: "other@example.test" }),
  );
  const other = t.backend.withIdentity({ subject: `${otherId}|session` });
  expect(await other.query(api.creditPurchases.status, { purchaseId: t.purchaseId })).toBeNull();
  expect(await t.owner.query(api.creditPurchases.status, { purchaseId: "invalid" })).toBeNull();
});
