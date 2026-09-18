# Scout credit packs

New checkouts sell 400 Scout credits for $5 USD before tax. The offer comes from
`apps/scout/convex/creditPolicy.ts`; Settings reads it from `credits.offer`.
One credit still covers $0.01 of tracked usage, and the signup grant remains 50 credits.
Existing balances are unchanged. Each checkout saves its price and credit quantity,
so an older 200-credit checkout still grants 200 credits when paid.

## Discounts and refunds

Checkout accepts discount codes configured in Polar, including 100% discounts.
A signed `order.paid` event grants the full saved credit quantity. Scout checks the
original subtotal against the saved $5 price and checks that net amount plus discount
equals that subtotal. Existing purchase, customer, product, environment, signature,
and duplicate-order checks still apply. Applied customer balances remain unsupported.

Scout saves the product amount paid after discount, excluding tax. Refunding half
that amount revokes half the pack; a full product refund revokes the full pack.
For example, a $1.25 product refund after a 50% discount revokes 200 of 400 credits.
Tax-only refunds do not revoke credits. A fully discounted order grants its pack
once and displays as paid, not refunded. Older paid records without the saved net
amount use their original full price, because discounts were previously rejected.

Polar documents these amounts in [checkout responses](https://polar.sh/docs/api-reference/2026-04/checkouts/create-checkout-session)
and [paid-order webhooks](https://polar.sh/docs/api-reference/2026-04/order_paid).

## Rollout

Apply these steps separately to the intended sandbox and production environments.
The primary development deployment may be in use; do not deploy this branch there
to verify billing.

1. Temporarily set `POLAR_CHECKOUT_ENABLED=false` on the target Convex deployment
   while coordinating the code deploy and product-copy update. Existing webhook
   settlement stays active while new checkout creation is disabled.
2. In Polar, edit the existing product selected by `POLAR_CREDIT_PRODUCT_ID`.
   Rename `Scout — 200 credits` to `Scout — 400 credits` and update any description
   mentioning 200. Keep its product ID, $5 USD one-time price, and tax setup.
   Scout supplies the fixed 500-cent price when creating checkout sessions.
3. Deploy the backend and frontend together. No balance backfill or changes to
   `POLAR_SERVER`, `POLAR_ORGANIZATION_ID`, `POLAR_CREDIT_PRODUCT_ID`, access token,
   webhook secret, or webhook URL are needed. Keep `order.paid` and `order.refunded`
   events enabled for `/polar/events`.
4. Re-enable `POLAR_CHECKOUT_ENABLED=true`. Start a fresh checkout from Settings;
   old checkout sessions keep their saved pack quantity and discount-code setting.
   Verify the 400-credit label, coupon entry, signed webhook delivery, and one
   400-credit grant. Sandbox verification should include a discounted payment,
   partial/full refunds, and a separate 100% discount redemption.

The `SCOUT4FREE` discount can keep its restriction to the same renamed product.
Creating a different product instead would require updating that restriction and
`POLAR_CREDIT_PRODUCT_ID`. A maximum of one redemption means one redemption across
all customers, not one per customer; change the separate per-customer limit only
if that is the intended offer. Sandbox and production need their own discounts.
