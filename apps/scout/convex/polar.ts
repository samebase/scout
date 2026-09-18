import { createPolar, webhooks } from "@polar-sh/sdk/2026-04";
import { v } from "convex/values";
import { action } from "./functions";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { checkoutEnabled, polarConfig, polarWebhookConfig } from "./polarConfig";
import { polarCheckoutSchema, polarOrderSchema, polarOrderRouteSchema } from "./polarModel";
import { creditsEnabled } from "./creditPolicy";

export const checkout = action({
  access: "access_play",
  args: {},
  returns: v.object({ url: v.string(), purchaseId: v.id("creditPurchases") }),
  handler: async (ctx): Promise<{ url: string; purchaseId: Id<"creditPurchases"> }> => {
    if (!creditsEnabled() || !checkoutEnabled())
      throw new Error("Credit purchases are not available yet");
    const config = polarConfig();
    const purchase = await ctx.runMutation(internal.creditPurchases.begin, {
      userId: ctx.viewer.userId,
    });
    try {
      const settings = new URL("/settings", config.siteUrl);
      const success = new URL(settings);
      success.searchParams.set("purchase", purchase._id);
      const provider = createPolar({
        accessToken: config.accessToken,
        environment: config.environment,
        timeout: 20,
      });
      const result = polarCheckoutSchema.parse(
        await provider.checkouts.create({
          products: [purchase.terms.productId],
          prices: {
            [purchase.terms.productId]: [
              {
                amount_type: "fixed",
                price_amount: purchase.terms.priceCents,
                price_currency: purchase.terms.currency,
                tax_behavior: "exclusive",
              },
            ],
          },
          external_customer_id: purchase.userId,
          metadata: { scout_purchase_id: purchase._id },
          allow_discount_codes: false,
          allow_trial: false,
          currency: "usd",
          success_url: success.toString(),
          return_url: settings.toString(),
        }),
      );
      if (
        result.organization_id !== purchase.terms.organizationId ||
        result.product_id !== purchase.terms.productId ||
        result.external_customer_id !== purchase.userId ||
        result.amount !== purchase.terms.priceCents ||
        result.currency !== purchase.terms.currency ||
        result.product_price.price_amount !== purchase.terms.priceCents
      )
        throw new Error("Polar checkout does not match the credit offer");
      await ctx.runMutation(internal.creditPurchases.recordCheckout, {
        purchaseId: purchase._id,
        result: { kind: "ready", checkoutId: result.id, url: result.url },
      });
      return { url: result.url, purchaseId: purchase._id };
    } catch (error) {
      await ctx.runMutation(internal.creditPurchases.recordCheckout, {
        purchaseId: purchase._id,
        result: {
          kind: "failed",
          reason: error instanceof Error ? error.message : "Checkout creation failed",
        },
      });
      throw error;
    }
  },
});

export function orderEvidence(value: unknown, environment: "sandbox" | "production") {
  const order = polarOrderSchema.parse(value);
  const purchaseReference = order.metadata["scout_purchase_id"];
  if (
    order.customer.id !== order.customer_id ||
    order.product.id !== order.product_id ||
    order.product.organization_id !== order.customer.organization_id
  )
    throw new Error("Unsupported or mismatched Polar credit order");
  return {
    purchaseReference,
    orderId: order.id,
    checkoutId: order.checkout_id,
    customerId: order.customer_id,
    externalCustomerId: order.customer.external_id,
    organizationId: order.customer.organization_id,
    productId: order.product_id,
    environment,
    currency: order.currency,
    paid: order.paid,
    netAmount: order.net_amount,
    refundedProductAmount: order.refunded_amount,
    refundedTaxAmount: order.refunded_tax_amount,
  };
}

export async function handlePolarEvent(ctx: ActionCtx, request: Request) {
  const config = polarWebhookConfig();
  let event;
  try {
    event = await webhooks.validateEvent(
      await request.text(),
      Object.fromEntries(request.headers),
      config.webhookSecret,
    );
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError)
      return new Response("Invalid signature", { status: 403 });
    if (error instanceof webhooks.PolarWebhookError)
      return new Response("Invalid webhook payload", { status: 400 });
    throw error;
  }
  if (event.type === "order.paid" || event.type === "order.refunded") {
    const route = polarOrderRouteSchema.parse(event.data);
    if (!route.metadata.scout_purchase_id) {
      const knownProduct = await ctx.runQuery(internal.creditPurchases.isCreditProduct, {
        productId: route.product_id,
        environment: config.environment,
      });
      if (knownProduct) throw new Error("Credit order is missing its Scout purchase reference");
      return new Response("Unrelated order", { status: 200 });
    }
    await ctx.runMutation(
      internal.creditPurchases.processOrder,
      orderEvidence(event.data, config.environment),
    );
  }
  return new Response("OK", { status: 200 });
}
