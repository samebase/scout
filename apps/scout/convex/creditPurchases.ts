import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getRuntimeEnv } from "./runtimeEnv";
import { query } from "./functions";
import { requireUserPermission } from "./access";
import { CREDIT_POLICY, creditsEnabled, nonnegativeInteger, signedInteger } from "./creditPolicy";
import { ensureCreditWallet, walletForUser } from "./creditLedger";
import { checkoutEnabled, polarConfig } from "./polarConfig";
import { paidOrderEvidenceValidator } from "./creditPurchasesModel";
import schema from "./schema";

export const isCreditProduct = internalQuery({
  args: {
    productId: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("production")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (
      args.productId === getRuntimeEnv("POLAR_CREDIT_PRODUCT_ID") &&
      args.environment === getRuntimeEnv("POLAR_SERVER")
    )
      return true;
    return (
      (await ctx.db
        .query("creditPurchases")
        .withIndex("by_product_and_environment", (q) =>
          q.eq("terms.productId", args.productId).eq("terms.environment", args.environment),
        )
        .first()) !== null
    );
  },
});

export const begin = internalMutation({
  args: { userId: v.id("users") },
  returns: schema.doc("creditPurchases"),
  handler: async (ctx, { userId }) => {
    await requireUserPermission(ctx, userId, "access_play");
    if (!creditsEnabled() || !checkoutEnabled())
      throw new Error("Credit purchases are not available yet");
    const config = polarConfig();
    await ensureCreditWallet(ctx, userId);
    const id = await ctx.db.insert("creditPurchases", {
      userId,
      terms: {
        policyVersion: CREDIT_POLICY.version,
        creditUnits: CREDIT_POLICY.packCredits * CREDIT_POLICY.unitsPerCredit,
        priceCents: CREDIT_POLICY.packPriceCents,
        currency: CREDIT_POLICY.currency,
        productId: config.productId,
        organizationId: config.organizationId,
        environment: config.environment,
      },
      checkoutId: null,
      checkout: { kind: "creating" },
      orderId: null,
      customerId: null,
      paid: false,
      refundedProductCents: 0,
      refundedTaxCents: 0,
      creditedUnits: 0,
      fulfillment: { kind: "pending" },
    });
    const purchase = await ctx.db.get(id);
    if (!purchase) throw new Error("Purchase was not created");
    return purchase;
  },
});

export const recordCheckout = internalMutation({
  args: {
    purchaseId: v.id("creditPurchases"),
    result: v.union(
      v.object({ kind: v.literal("ready"), checkoutId: v.string(), url: v.string() }),
      v.object({ kind: v.literal("failed"), reason: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { purchaseId, result }) => {
    const purchase = await ctx.db.get(purchaseId);
    if (!purchase) throw new Error("Purchase is missing");
    if (result.kind === "ready") {
      if (purchase.checkoutId !== null && purchase.checkoutId !== result.checkoutId)
        throw new Error("Checkout identity cannot change");
      await ctx.db.patch(purchaseId, {
        checkoutId: result.checkoutId,
        checkout: { kind: "ready", url: result.url },
      });
    } else if (purchase.checkout.kind === "creating" && !purchase.paid)
      await ctx.db.patch(purchaseId, { checkout: result });
    return null;
  },
});

export const processOrder = internalMutation({
  args: paidOrderEvidenceValidator.fields,
  returns: v.null(),
  handler: async (ctx, order) => {
    const purchaseId = ctx.db.normalizeId("creditPurchases", order.purchaseReference);
    const purchase = purchaseId && (await ctx.db.get(purchaseId));
    if (!purchase) throw new Error("Order has no Scout purchase");
    const terms = purchase.terms;
    if (
      order.externalCustomerId !== purchase.userId ||
      order.organizationId !== terms.organizationId ||
      order.productId !== terms.productId ||
      order.environment !== terms.environment ||
      order.currency !== terms.currency ||
      order.subtotalAmount !== terms.priceCents ||
      order.netAmount + order.discountAmount !== terms.priceCents ||
      !order.paid
    )
      throw new Error("Order does not match the stored purchase terms");
    if (purchase.checkoutId !== null && purchase.checkoutId !== order.checkoutId)
      throw new Error("Order belongs to another checkout");
    if (purchase.orderId !== null && purchase.orderId !== order.orderId)
      throw new Error("A purchase cannot grant a second order");
    if (purchase.customerId !== null && purchase.customerId !== order.customerId)
      throw new Error("Purchase customer cannot change");
    if (purchase.paid && (purchase.paidProductCents ?? terms.priceCents) !== order.netAmount)
      throw new Error("Paid product amount cannot change");
    const duplicateOrder = await ctx.db
      .query("creditPurchases")
      .withIndex("by_order_id", (q) => q.eq("orderId", order.orderId))
      .unique();
    if (duplicateOrder && duplicateOrder._id !== purchase._id)
      throw new Error("Order was already assigned to another purchase");
    const refundedProductCents = Math.max(
      purchase.refundedProductCents,
      nonnegativeInteger.parse(order.refundedProductAmount),
    );
    const refundedTaxCents = Math.max(
      purchase.refundedTaxCents,
      nonnegativeInteger.parse(order.refundedTaxAmount),
    );
    if (refundedProductCents > order.netAmount)
      throw new Error("Refund exceeds the purchased product amount");
    const user = await ctx.db.get(purchase.userId);
    const fulfillment =
      purchase.fulfillment.kind !== "pending"
        ? purchase.fulfillment
        : !user || user.state === "deleted" || user.state === "deleting"
          ? {
              kind: "manual_refund" as const,
              reason: "Payment arrived after account deletion began",
            }
          : { kind: "wallet" as const };
    const creditedUnits =
      fulfillment.kind === "wallet"
        ? nonnegativeInteger.parse(
            order.netAmount === 0
              ? terms.creditUnits
              : Math.floor(
                  (terms.creditUnits * (order.netAmount - refundedProductCents)) / order.netAmount,
                ),
          )
        : 0;
    const delta = creditedUnits - purchase.creditedUnits;
    if (delta !== 0) {
      const wallet = await walletForUser(ctx, purchase.userId);
      if (!wallet) throw new Error("Purchase wallet is missing");
      const balanceAfterUnits = signedInteger.parse(wallet.balanceUnits + delta);
      await ctx.db.insert("creditEntries", {
        userId: purchase.userId,
        sourceKey: `polar:${order.orderId}:${refundedProductCents}`,
        amountUnits: delta,
        balanceAfterUnits,
        detail: { kind: delta > 0 ? "purchase" : "refund", purchaseId: purchase._id },
      });
      await ctx.db.patch(wallet._id, { balanceUnits: balanceAfterUnits });
    }
    await ctx.db.patch(purchase._id, {
      paid: true,
      paidProductCents: order.netAmount,
      orderId: order.orderId,
      customerId: order.customerId,
      checkoutId: order.checkoutId,
      refundedProductCents,
      refundedTaxCents,
      creditedUnits,
      fulfillment,
    });
    return null;
  },
});

export const status = query({
  access: "access_account",
  args: { purchaseId: v.string() },
  returns: v.union(
    v.null(),
    v.literal("pending"),
    v.literal("paid"),
    v.literal("partially_refunded"),
    v.literal("refunded"),
    v.literal("needs_review"),
    v.literal("checkout_failed"),
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("creditPurchases", args.purchaseId);
    const purchase = id && (await ctx.db.get(id));
    if (!purchase || purchase.userId !== ctx.viewer.userId) return null;
    if (
      purchase.paid &&
      purchase.refundedProductCents > 0 &&
      purchase.refundedProductCents === (purchase.paidProductCents ?? purchase.terms.priceCents)
    )
      return "refunded";
    if (purchase.fulfillment.kind === "manual_refund") return "needs_review";
    if (purchase.paid)
      return purchase.refundedProductCents > 0 || purchase.refundedTaxCents > 0
        ? "partially_refunded"
        : "paid";
    return purchase.checkout.kind === "failed" ? "checkout_failed" : "pending";
  },
});
