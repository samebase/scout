import { Link } from "@tanstack/react-router";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { canAccess, useViewerAccess } from "../lib/access";
import { Button } from "./ui/button";

const credits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const dollars = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

type CreditDetail = FunctionReturnType<typeof api.credits.history>["page"][number]["detail"];

function entryLabel(detail: CreditDetail) {
  switch (detail.kind) {
    case "signup":
      return "Signup credits";
    case "usage":
      return "AI and web usage";
    case "purchase":
      return "Credit purchase";
    case "refund":
      return "Purchase refunded";
    case "session_model":
      return "Scout conversation";
    case "session_web_search":
      return "Web search";
    case "adjustment":
      return detail.reason;
    default: {
      const unhandled: never = detail;
      return unhandled;
    }
  }
}

export function CreditBalanceLink() {
  const balance = useQuery(api.credits.balance, {});
  const offer = useQuery(api.credits.offer, {});
  if (!balance || !offer) return null;

  const available = credits.format(balance.availableUnits / offer.unitsPerCredit);
  return (
    <Link
      to="/settings"
      className="hidden shrink-0 rounded-lg px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:inline"
      aria-label={`${available} credits available. View credit history in settings.`}
    >
      {available} credits
    </Link>
  );
}

export function CreditsPanel() {
  const viewer = useViewerAccess();
  const balance = useQuery(api.credits.balance, {});
  const offer = useQuery(api.credits.offer, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.credits.history,
    {},
    { initialNumItems: 10 },
  );
  const ensureWallet = useMutation(api.credits.ensureWallet);
  const createCheckout = useAction(api.polar.checkout);
  const [walletError, setWalletError] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "pending" | "failed">("idle");

  useEffect(() => {
    if (balance !== null) return;
    let active = true;
    void ensureWallet({}).catch(() => {
      if (active) setWalletError(true);
    });
    return () => {
      active = false;
    };
  }, [balance, ensureWallet]);

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

  return (
    <section className="surface-panel mt-8 p-5 sm:p-6" aria-labelledby="credits-heading">
      <h2 id="credits-heading" className="text-base font-semibold">
        Credits
      </h2>
      {walletError && balance === null ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Could not load your credits. Refresh to try again.
        </p>
      ) : !balance || !offer ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading credits…</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:p-5">
            <div>
              <p className="text-sm text-muted-foreground">Available balance</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {credits.format(balance.availableUnits / offer.unitsPerCredit)}{" "}
                <span className="text-sm font-normal text-muted-foreground">credits</span>
              </p>
              {balance.reservedUnits > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {credits.format(balance.reservedUnits / offer.unitsPerCredit)} reserved for
                  ongoing work
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

          <div className="mt-8 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Credit history</h3>
            {status === "LoadingFirstPage" ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading history…</p>
            ) : results.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No credit activity yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border" aria-label="Credit history">
                {results.map((entry) => (
                  <li
                    key={entry._id}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <div>
                      <p>{entryLabel(entry.detail)}</p>
                      <time
                        dateTime={new Date(entry._creationTime).toISOString()}
                        className="mt-0.5 block text-xs text-muted-foreground"
                      >
                        {new Date(entry._creationTime).toLocaleString()}
                      </time>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {entry.amountUnits > 0 ? "+" : ""}
                      {credits.format(entry.amountUnits / offer.unitsPerCredit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {status === "CanLoadMore" && (
              <Button className="mt-3" variant="outline" onClick={() => loadMore(10)}>
                More history
              </Button>
            )}
            {status === "LoadingMore" && (
              <p className="mt-3 text-sm text-muted-foreground">Loading more history…</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
