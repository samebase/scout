import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";

const historyCredits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function formatCreditChange(amount: number) {
  if (amount !== 0 && Math.abs(amount) < 0.01) {
    return `${amount < 0 ? "-" : "+"}<${historyCredits.format(0.01)}`;
  }
  return `${amount > 0 ? "+" : ""}${historyCredits.format(amount)}`;
}

type CreditDetail = FunctionReturnType<typeof api.credits.history>["page"][number]["detail"];

function entryLabel(detail: CreditDetail) {
  switch (detail.kind) {
    case "signup":
      return "Signup credits";
    case "usage":
      return {
        model: "AI usage",
        request_check: "Request check",
        research: "Research",
        browser: "Browser use",
        web_search: "Web search",
      }[detail.usageKind];
    case "purchase":
      return "Credit purchase";
    case "refund":
      return "Purchase refunded";
    case "adjustment":
      return detail.reason;
    default: {
      const unhandled: never = detail;
      return unhandled;
    }
  }
}

export function CreditHistoryPage() {
  const offer = useQuery(api.credits.offer, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.credits.history,
    {},
    { initialNumItems: 10 },
  );

  return (
    <main className="route-page max-w-3xl">
      <header>
        <Link to="/settings" className="text-sm text-muted-foreground underline">
          Back to Settings
        </Link>
        <h1 className="route-heading mt-4">Credit history</h1>
      </header>
      <section
        className="surface-panel mt-8 min-h-40 p-5 sm:p-6"
        aria-label="Credit activity"
        aria-busy={!offer || status === "LoadingFirstPage" || status === "LoadingMore"}
      >
        {!offer || status === "LoadingFirstPage" ? null : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit activity yet.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Credit history">
            {results.map((entry) => (
              <li key={entry._id} className="flex items-center justify-between gap-4 py-3 text-sm">
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
                  {formatCreditChange(entry.amountUnits / offer.unitsPerCredit)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(status === "CanLoadMore" || status === "LoadingMore") && (
          <Button
            className="mt-3"
            variant="outline"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(10)}
          >
            More history
          </Button>
        )}
      </section>
    </main>
  );
}
