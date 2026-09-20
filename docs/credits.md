# Scout credit packs

New checkouts sell 400 Scout credits for $5 USD before tax. The offer comes from
`apps/scout/convex/creditPolicy.ts`; Settings reads it from `credits.offer`.
One credit still covers $0.01 of tracked usage, and the signup grant remains 50 credits.
Existing balances are unchanged. Each checkout saves its price and credit quantity,
so an older 200-credit checkout still grants 200 credits when paid.

## Included Firecrawl usage

New Firecrawl browser sessions and site research are included by default during the beta.
They still record provider credit usage, but do not deduct Scout credits. AI model calls,
request checks, and hosted web search keep their existing credit deductions. Settings
shows the included-usage notice; task cost details label Firecrawl's separate credit unit.
The task dollar subtotal excludes Firecrawl browsing and research.

Set `FIRECRAWL_CREDITS_ENABLED=true` on the intended Convex deployment to charge for new
Firecrawl work again. Unset or `false` includes it; other values fail validation.
`CREDITS_ENABLED` remains the overall usage-billing switch.

Each browser admission and research job saves its billing choice. Changing the setting
does not alter existing jobs, delayed usage reports, or previous deductions. Included
Firecrawl work does not bypass the balance check for a paid task. If charging is enabled,
the existing assumption is $0.005 per Firecrawl credit, or 0.5 Scout credits. This is a
pricing assumption, not the cash cost of included or promotional Firecrawl credits.

The $5 pack stays at 400 credits, and the signup grant stays at 50. No Polar product,
checkout price, or balance changes are needed for this rollout.

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

1. Deploy the backend and frontend together. No balance backfill or changes to
   `POLAR_SERVER`, `POLAR_ORGANIZATION_ID`, `POLAR_CREDIT_PRODUCT_ID`, access token,
   webhook secret, or webhook URL are needed. Keep `order.paid` and `order.refunded`
   events enabled for `/polar/events`.
2. Leave `FIRECRAWL_CREDITS_ENABLED` unset or set it to `false` to include new
   Firecrawl work. Keep `CREDITS_ENABLED=true` for AI and web-search deductions.
   Verify Settings shows the inclusion notice. Run a new task and confirm provider
   usage is recorded while only AI and web search deduct Scout credits.
3. With `POLAR_CHECKOUT_ENABLED=true`, start a fresh checkout from Settings;
   old checkout sessions keep their saved pack quantity and discount-code setting.
   Verify the 400-credit label, coupon entry, signed webhook delivery, and one
   400-credit grant. Sandbox verification should include a discounted payment,
   partial/full refunds, and a separate 100% discount redemption.

The `SCOUT4FREE` discount can keep its restriction to the same product.
Creating a different product instead would require updating that restriction and
`POLAR_CREDIT_PRODUCT_ID`. A maximum of one redemption means one redemption across
all customers, not one per customer; change the separate per-customer limit only
if that is the intended offer. Sandbox and production need their own discounts.
