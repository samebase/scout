/// <reference types="vite/client" />
import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertTestAccount } from "./testing/accounts";
import { orderEvidence } from "./polar";
import { checkoutEnabled } from "./polarConfig";
import { polarCheckoutSchema } from "./polarModel";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const organizationId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

beforeEach(() => {
  vi.stubEnv("CREDITS_ENABLED", "true");
  vi.stubEnv("POLAR_SERVER", "sandbox");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "sandbox-test-token");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", secret);
  vi.stubEnv("POLAR_ORGANIZATION_ID", organizationId);
  vi.stubEnv("POLAR_CREDIT_PRODUCT_ID", productId);
  vi.stubEnv("POLAR_CHECKOUT_ENABLED", "true");
  vi.stubEnv("SITE_URL", "https://scout.example.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(schema, modules);
  const userId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "buyer@example.test" }),
  );
  const owner = backend.withIdentity({ subject: `${userId}|session` });
  const purchase = await backend.mutation(internal.creditPurchases.begin, { userId });
  await backend.mutation(internal.creditPurchases.recordCheckout, {
    purchaseId: purchase._id,
    result: { kind: "ready", checkoutId: "checkout-1", url: "https://sandbox.polar.sh/checkout/1" },
  });
  return { backend, owner, userId, purchase };
}

function paidOrder(purchase: Doc<"creditPurchases">, suffix = "1") {
  return {
    id: `order-${suffix}`,
    checkout_id: `checkout-${suffix}`,
    product_id: productId,
    customer_id: "customer-1",
    metadata: { scout_purchase_id: purchase._id },
    paid: true,
    billing_reason: "purchase",
    subscription_id: null,
    units: null,
    subtotal_amount: 500,
    discount_amount: 0,
    applied_balance_amount: 0,
    currency: "usd",
    net_amount: 500,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    customer: {
      id: "customer-1",
      external_id: "samebase-existing-user",
      organization_id: organizationId,
    },
    product: { id: productId, organization_id: organizationId, is_recurring: false },
  };
}

function signedEvent(
  type: string,
  data: unknown,
  format: "standard" | "legacy" = "standard",
  timestamp = Math.floor(Date.now() / 1_000),
) {
  const body = JSON.stringify({ type, timestamp: new Date(timestamp * 1_000).toISOString(), data });
  const key = format === "legacy" ? Buffer.from(secret) : Buffer.from(secret.slice(6), "base64");
  const signature = createHmac("sha256", key)
    .update(`event-1.${timestamp}.${body}`)
    .digest("base64");
  return {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": "event-1",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    },
  };
}

describe("Polar credit settlement", () => {
  test("leaves checkout disabled unless explicitly enabled", async () => {
    const { backend, owner, userId } = await setup();
    vi.stubEnv("POLAR_CHECKOUT_ENABLED", undefined);
    expect(checkoutEnabled()).toBe(false);
    await expect(owner.action(api.polar.checkout, {})).rejects.toThrow(
      "Credit purchases are not available yet",
    );
    const purchases = await backend.run((ctx) =>
      ctx.db
        .query("creditPurchases")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .take(2),
    );
    expect(purchases).toHaveLength(1);
  });

  test.each([0, 250, 500])(
    "creates a checkout allowing discounts, with %i cents discounted",
    async (discount) => {
      const { backend, owner, userId } = await setup();
      const requests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          requests.push(new Request(input, init));
          return Response.json({
            id: "sandbox-checkout",
            url: "https://sandbox.polar.sh/checkout/sandbox-checkout",
            organization_id: organizationId,
            product_id: productId,
            external_customer_id: userId,
            amount: 500,
            currency: "usd",
            discount_amount: discount,
            net_amount: 500 - discount,
            is_payment_required: discount < 500,
            units: null,
            subscription_id: null,
            allow_discount_codes: true,
            tax_behavior: "exclusive",
            product: { is_recurring: false },
            product_price: { amount_type: "fixed", price_amount: 500, price_currency: "usd" },
          });
        }),
      );
      const result = await owner.action(api.polar.checkout, {});
      expect(requests).toHaveLength(1);
      const [request] = requests;
      if (!request) throw new Error("Expected a checkout request");
      expect(request.url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
      expect(await request.json()).toMatchObject({
        products: [productId],
        prices: {
          [productId]: [
            {
              amount_type: "fixed",
              price_amount: 500,
              price_currency: "usd",
              tax_behavior: "exclusive",
            },
          ],
        },
        external_customer_id: userId,
        customer_email: "buyer@example.test",
        metadata: { scout_purchase_id: result.purchaseId },
        allow_discount_codes: true,
        success_url: `https://scout.example.test/settings?purchase=${result.purchaseId}`,
      });
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
      expect(await owner.query(api.credits.offer, {})).toMatchObject({
        packCredits: 400,
        packPriceCents: 500,
        unitsPerCredit: 10_000,
        signupCredits: 50,
      });
      expect(await backend.run((ctx) => ctx.db.get(result.purchaseId))).toMatchObject({
        terms: { creditUnits: 4_000_000, priceCents: 500 },
      });
      expect(await owner.query(api.creditPurchases.status, { purchaseId: result.purchaseId })).toBe(
        "pending",
      );
    },
  );

  test.each([0, 250, 500])(
    "a signed paid webhook with %i cents discounted grants the full pack exactly once",
    async (discount) => {
      const { backend, owner, purchase } = await setup();
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
      const event = signedEvent("order.paid", {
        ...paidOrder(purchase),
        discount_amount: discount,
        net_amount: 500 - discount,
      });
      expect((await backend.fetch("/polar/events", event)).status).toBe(200);
      expect((await backend.fetch("/polar/events", event)).status).toBe(200);
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 4_500_000 });
      expect(await owner.query(api.creditPurchases.status, { purchaseId: purchase._id })).toBe(
        "paid",
      );
      expect(await backend.run((ctx) => ctx.db.get(purchase._id))).toMatchObject({
        paidProductCents: 500 - discount,
        creditedUnits: 4_000_000,
        refundedProductCents: 0,
      });
      expect(
        (await owner.query(api.credits.history, { paginationOpts: { cursor: null, numItems: 10 } }))
          .page,
      ).toHaveLength(2);
      await expect(
        backend.fetch(
          "/polar/events",
          signedEvent("order.refunded", {
            ...paidOrder(purchase),
            discount_amount: discount,
            net_amount: 500 - discount,
            refunded_amount: 501 - discount,
          }),
        ),
      ).rejects.toThrow("Refund exceeds");
    },
  );

  test("supports both signing formats and rejects invalid or expired signatures", async () => {
    const { backend, owner, purchase } = await setup();
    const order = paidOrder(purchase);
    expect(
      (await backend.fetch("/polar/events", signedEvent("order.paid", order, "legacy"))).status,
    ).toBe(200);
    const invalid = signedEvent("order.paid", order);
    invalid.body += " ";
    expect((await backend.fetch("/polar/events", invalid)).status).toBe(403);
    expect(
      (
        await backend.fetch(
          "/polar/events",
          signedEvent("order.paid", order, "standard", Math.floor(Date.now() / 1_000) - 600),
        )
      ).status,
    ).toBe(403);
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 4_500_000 });
  });

  test.each([500, 250])(
    "refunds use the %i cents paid, including duplicates and out-of-order events",
    async (paid) => {
      const { backend, owner, userId, purchase } = await setup();
      const order = { ...paidOrder(purchase), discount_amount: 500 - paid, net_amount: paid };
      const apply = (refunded: number) =>
        backend.fetch(
          "/polar/events",
          signedEvent(refunded > 0 ? "order.refunded" : "order.paid", {
            ...order,
            refunded_amount: refunded,
            refunded_tax_amount: refunded / 5,
          }),
        );
      await apply(paid / 2);
      await apply(0);
      await apply(paid / 2);
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
      expect(await owner.query(api.creditPurchases.status, { purchaseId: purchase._id })).toBe(
        "partially_refunded",
      );
      await apply(paid);
      await apply(paid / 2);
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
      expect(await owner.query(api.creditPurchases.status, { purchaseId: purchase._id })).toBe(
        "refunded",
      );
      await expect(apply(paid + 5)).rejects.toThrow("Refund exceeds");
      const second = await backend.mutation(internal.creditPurchases.begin, { userId });
      await backend.mutation(internal.creditPurchases.recordCheckout, {
        purchaseId: second._id,
        result: {
          kind: "ready",
          checkoutId: "checkout-2",
          url: "https://sandbox.polar.sh/checkout/2",
        },
      });
      await backend.mutation(
        internal.creditPurchases.processOrder,
        orderEvidence(paidOrder(second, "2"), "sandbox"),
      );
      expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 4_500_000 });
    },
  );

  test("checks environment, immutable price, checkout, and order identity", async () => {
    const { backend, owner, purchase, userId } = await setup();
    const evidence = orderEvidence(paidOrder(purchase), "sandbox");
    for (const change of [
      { environment: "production" as const },
      { productId: "other-product" },
      { organizationId: "other-organization" },
      { currency: "eur" },
      { netAmount: 1 },
      { subtotalAmount: 501 },
      { discountAmount: 100 },
      { paid: false },
    ]) {
      await expect(
        backend.mutation(internal.creditPurchases.processOrder, { ...evidence, ...change }),
      ).rejects.toThrow("terms");
    }
    await backend.mutation(internal.creditPurchases.processOrder, evidence);
    await expect(
      backend.mutation(internal.creditPurchases.processOrder, {
        ...evidence,
        netAmount: 250,
        discountAmount: 250,
      }),
    ).rejects.toThrow("Paid product amount cannot change");
    await expect(
      backend.mutation(internal.creditPurchases.processOrder, {
        ...evidence,
        orderId: "second-order",
      }),
    ).rejects.toThrow("second order");
    await expect(
      backend.mutation(internal.creditPurchases.processOrder, {
        ...evidence,
        checkoutId: "another-checkout",
      }),
    ).rejects.toThrow("another checkout");
    const second = await backend.mutation(internal.creditPurchases.begin, { userId });
    await backend.mutation(internal.creditPurchases.recordCheckout, {
      purchaseId: second._id,
      result: {
        kind: "ready",
        checkoutId: evidence.checkoutId,
        url: "https://sandbox.polar.sh/checkout/1",
      },
    });
    await expect(
      backend.mutation(internal.creditPurchases.processOrder, {
        ...evidence,
        purchaseReference: second._id,
      }),
    ).rejects.toThrow("another purchase");
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 4_500_000 });
  });

  test("matches a discounted order to its checkout when the Polar customer has no external ID", async () => {
    const { backend, owner, purchase } = await setup();
    const order = paidOrder(purchase);
    const event = signedEvent("order.paid", {
      ...order,
      customer: { ...order.customer, external_id: null },
      discount_amount: 500,
      net_amount: 0,
    });
    expect((await backend.fetch("/polar/events", event)).status).toBe(200);
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 4_500_000 });
  });

  test("rejects unrecorded checkouts and another user's purchase reference", async () => {
    const { backend, owner, purchase } = await setup();
    const otherId = await backend.run((ctx) =>
      insertTestAccount(ctx, { email: "other@example.test" }),
    );
    const otherPurchase = await backend.mutation(internal.creditPurchases.begin, {
      userId: otherId,
    });
    const event = signedEvent("order.paid", {
      ...paidOrder(purchase),
      metadata: { scout_purchase_id: otherPurchase._id },
    });
    await expect(backend.fetch("/polar/events", event)).rejects.toThrow("has not been recorded");
    await backend.mutation(internal.creditPurchases.recordCheckout, {
      purchaseId: otherPurchase._id,
      result: {
        kind: "ready",
        checkoutId: "other-checkout",
        url: "https://sandbox.polar.sh/checkout/other",
      },
    });
    await expect(backend.fetch("/polar/events", event)).rejects.toThrow("another checkout");
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    const other = backend.withIdentity({ subject: `${otherId}|session` });
    expect(await other.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
  });

  test("honors an old 200-credit checkout and exposes an already-spent refund as a deficit", async () => {
    const { backend, owner, purchase, userId } = await setup();
    await backend.run((ctx) =>
      ctx.db.patch(purchase._id, {
        terms: { ...purchase.terms, policyVersion: "2026-09-10", creditUnits: 2_000_000 },
      }),
    );
    const order = paidOrder(purchase);
    await backend.mutation(internal.creditPurchases.processOrder, orderEvidence(order, "sandbox"));
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
    await backend.run((ctx) => ctx.db.patch(purchase._id, { paidProductCents: undefined }));
    await backend.mutation(internal.creditPurchases.processOrder, orderEvidence(order, "sandbox"));
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
    await backend.run(async (ctx) => {
      const wallet = await ctx.db
        .query("creditWallets")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .unique();
      if (!wallet) throw new Error("Missing wallet");
      await ctx.db.patch(wallet._id, { balanceUnits: 0 });
    });
    await backend.mutation(
      internal.creditPurchases.processOrder,
      orderEvidence({ ...order, refunded_amount: 500 }, "sandbox"),
    );
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: -2_000_000 });
  });

  test("does not fulfill a late payment to a deleted account or its replacement", async () => {
    const { backend, purchase, userId } = await setup();
    await backend.run((ctx) => ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() }));
    const replacementId = await backend.run((ctx) =>
      insertTestAccount(ctx, { email: "buyer@example.test" }),
    );
    await backend.mutation(
      internal.creditPurchases.processOrder,
      orderEvidence(paidOrder(purchase), "sandbox"),
    );
    expect(await backend.run((ctx) => ctx.db.get(purchase._id))).toMatchObject({
      paid: true,
      creditedUnits: 0,
      fulfillment: { kind: "manual_refund" },
    });
    const replacement = backend.withIdentity({ subject: `${replacementId}|session` });
    expect(await replacement.query(api.credits.balance, {})).toBeNull();
    expect(
      await replacement.query(api.creditPurchases.status, { purchaseId: purchase._id }),
    ).toBeNull();
    await expect(backend.mutation(internal.creditPurchases.begin, { userId })).rejects.toThrow(
      "Not authorized",
    );
  });

  test("rejects malformed signed fields and fails closed before ledger mutation", async () => {
    const { backend, owner, purchase } = await setup();
    await expect(
      backend.fetch(
        "/polar/events",
        signedEvent("order.paid", { ...paidOrder(purchase), refunded_amount: -1 }),
      ),
    ).rejects.toThrow();
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    expect(() => orderEvidence({ type: "order.paid" }, "sandbox")).toThrow();
    expect(() => polarCheckoutSchema.parse({ url: "javascript:alert(1)" })).toThrow();
  });
});

test("settles delayed refunds after checkout config is removed and skips unrelated orders", async () => {
  const { backend, owner, purchase } = await setup();
  await backend.fetch("/polar/events", signedEvent("order.paid", paidOrder(purchase)));
  for (const key of [
    "POLAR_ACCESS_TOKEN",
    "POLAR_ORGANIZATION_ID",
    "POLAR_CREDIT_PRODUCT_ID",
    "SITE_URL",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("POLAR_CHECKOUT_ENABLED", "false");
  expect(
    (
      await backend.fetch(
        "/polar/events",
        signedEvent("order.refunded", {
          ...paidOrder(purchase),
          refunded_amount: 500,
        }),
      )
    ).status,
  ).toBe(200);
  expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
  expect(
    (
      await backend.fetch(
        "/polar/events",
        signedEvent("order.paid", {
          product_id: "unrelated-product",
          metadata: {},
        }),
      )
    ).status,
  ).toBe(200);
  await expect(
    backend.fetch(
      "/polar/events",
      signedEvent("order.paid", {
        product_id: productId,
        metadata: {},
      }),
    ),
  ).rejects.toThrow("missing its Scout purchase reference");
});
