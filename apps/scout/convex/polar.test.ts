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
    discount_amount: 0,
    applied_balance_amount: 0,
    currency: "usd",
    net_amount: 500,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    customer: { id: "customer-1", external_id: purchase.userId, organization_id: organizationId },
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

  test("creates a sandbox checkout with the stored offer and tax added, without granting credits", async () => {
    const { owner, userId } = await setup();
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
          discount_amount: 0,
          is_payment_required: true,
          units: null,
          subscription_id: null,
          allow_discount_codes: false,
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
      metadata: { scout_purchase_id: result.purchaseId },
      allow_discount_codes: false,
      success_url: `https://scout.example.test/settings?purchase=${result.purchaseId}`,
    });
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    expect(
      await owner.query(api.creditPurchases.status, { purchaseId: result.purchaseId }),
    ).toMatchObject({
      paid: false,
      creditedUnits: 0,
      fulfillment: { kind: "pending" },
      checkout: { kind: "ready", url: result.url },
    });
  });

  test("a checkout attempt grants nothing; a verified paid webhook grants exactly once", async () => {
    const { backend, owner, purchase } = await setup();
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    const event = signedEvent("order.paid", paidOrder(purchase));
    expect((await backend.fetch("/polar/events", event)).status).toBe(200);
    expect((await backend.fetch("/polar/events", event)).status).toBe(200);
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
    expect(
      (await owner.query(api.credits.history, { paginationOpts: { cursor: null, numItems: 10 } }))
        .page,
    ).toHaveLength(2);
  });

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
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
  });

  test("partial, duplicate, and out-of-order refunds converge; another purchase grants a new pack", async () => {
    const { backend, owner, userId, purchase } = await setup();
    const order = paidOrder(purchase);
    const apply = (refunded: number) =>
      backend.mutation(
        internal.creditPurchases.processOrder,
        orderEvidence(
          { ...order, refunded_amount: refunded, refunded_tax_amount: refunded / 5 },
          "sandbox",
        ),
      );
    await apply(250);
    await apply(0);
    await apply(250);
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 1_500_000 });
    await apply(500);
    await apply(250);
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 500_000 });
    const second = await backend.mutation(internal.creditPurchases.begin, { userId });
    await backend.mutation(
      internal.creditPurchases.processOrder,
      orderEvidence(paidOrder(second, "2"), "sandbox"),
    );
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
  });

  test("checks customer, environment, immutable price, checkout, and order identity", async () => {
    const { backend, owner, purchase, userId } = await setup();
    const evidence = orderEvidence(paidOrder(purchase), "sandbox");
    for (const change of [
      { externalCustomerId: "other-user" },
      { environment: "production" as const },
      { productId: "other-product" },
      { netAmount: 1 },
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
    await expect(
      backend.mutation(internal.creditPurchases.processOrder, {
        ...evidence,
        purchaseReference: second._id,
      }),
    ).rejects.toThrow("another purchase");
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 2_500_000 });
  });

  test("honors snapshotted pack sizes and exposes an already-spent refund as a deficit", async () => {
    const { backend, owner, purchase, userId } = await setup();
    await backend.run((ctx) =>
      ctx.db.patch(purchase._id, { terms: { ...purchase.terms, creditUnits: 1_000_000 } }),
    );
    const order = paidOrder(purchase);
    await backend.mutation(internal.creditPurchases.processOrder, orderEvidence(order, "sandbox"));
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: 1_500_000 });
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
    expect(await owner.query(api.credits.balance, {})).toMatchObject({ balanceUnits: -1_000_000 });
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
