import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { canAccess, useViewerAccess } from "../lib/access";
import { Button } from "./ui/button";

const wholeCredits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const credits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

const purchaseMessages = {
  pending: "Waiting for payment confirmation. Your balance will update here.",
  paid: "Payment confirmed. Credits were added to your balance.",
  partially_refunded: "Your payment was partially refunded. Your credit balance is up to date.",
  refunded: "Your payment was refunded. No credits remain from this purchase.",
  needs_review: "Your payment needs review. Contact an admin with this page’s link.",
  checkout_failed: "Checkout could not be opened. Try buying credits again.",
} satisfies Record<NonNullable<FunctionReturnType<typeof api.creditPurchases.status>>, string>;

export function CreditBalanceLink() {
  const balance = useQuery(api.credits.balance, {});
  const offer = useQuery(api.credits.offer, {});
  if (!balance || !offer?.usageEnabled) return null;

  const value = balance.balanceUnits / offer.unitsPerCredit;
  const amount =
    value >= 0
      ? wholeCredits.format(Math.floor(value))
      : value > -0.1
        ? `-<${credits.format(0.1)}`
        : credits.format(value);
  return (
    <Link
      to="/settings"
      className="hidden shrink-0 rounded-lg px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:inline"
      aria-label={`${amount} credits. Manage credits in settings.`}
    >
      {amount} credits
    </Link>
  );
}

export function CreditsPanel({ purchaseId }: { purchaseId: string | undefined }) {
  const viewer = useViewerAccess();
  const balance = useQuery(api.credits.balance, {});
  const offer = useQuery(api.credits.offer, {});
  const purchase = useQuery(api.creditPurchases.status, purchaseId ? { purchaseId } : "skip");
  const ensureWallet = useMutation(api.credits.ensureWallet);
  const createCheckout = useAction(api.polar.checkout);
  const [walletError, setWalletError] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "pending" | "failed">("idle");

  useEffect(() => {
    if (offer?.usageEnabled !== true || balance !== null) return;
    let active = true;
    void ensureWallet({}).catch(() => {
      if (active) setWalletError(true);
    });
    return () => {
      active = false;
    };
  }, [balance, ensureWallet, offer?.usageEnabled]);

  const canBuy = viewer?.kind === "account" && canAccess("access_play", viewer.accessKeys);
  const buy = async () => {
    if (!canBuy || !offer?.checkoutEnabled || checkoutState === "pending") return;
    setCheckoutState("pending");
    try {
      const checkout = await createCheckout({});
      window.location.assign(checkout.url);
    } catch {
      setCheckoutState("failed");
    }
  };

  if (offer?.usageEnabled === false) return null;

  return (
    <section className="surface-panel mt-8 p-5 sm:p-6" aria-labelledby="credits-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="credits-heading" className="text-base font-semibold">
          Credits
        </h2>
        <Link to="/credit-history" className="text-sm underline">
          View credit history
        </Link>
      </div>
      {walletError && balance === null ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Could not load your credits. Refresh to try again.
        </p>
      ) : !balance || !offer ? (
        <div className="mt-4 min-h-40" aria-busy="true" />
      ) : (
        <>
          {purchaseId && purchase && (
            <p className="mt-4 text-sm" role="status">
              {purchaseMessages[purchase]}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:p-5">
            <div>
              <p className="text-sm text-muted-foreground">Balance</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {credits.format(balance.balanceUnits / offer.unitsPerCredit)}{" "}
                <span className="text-sm font-normal text-muted-foreground">credits</span>
              </p>
              {balance.balanceUnits <= 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Add credits before starting new work.
                </p>
              )}
            </div>
            <Button
              type="button"
              disabled={!canBuy || !offer.checkoutEnabled || checkoutState === "pending"}
              onClick={() => void buy()}
            >
              {checkoutState === "pending"
                ? "Opening checkout…"
                : `Add ${credits.format(offer.packCredits)} credits for ${dollars.format(offer.packPriceCents / 100)}`}
            </Button>
          </div>
          {balance.hold.kind === "held" && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {balance.hold.reason}
            </p>
          )}
          {!canBuy ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Account approval is required to buy credits.
            </p>
          ) : !offer.checkoutEnabled ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Credit purchases are unavailable right now.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Applicable tax is added at checkout.
            </p>
          )}
          {checkoutState === "failed" && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Could not open checkout. Try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
