import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const modelPricingCopy = {
  standard_short_context_excluding_cache_writes: {
    label: "Model estimate",
    note: "Estimated OpenAI cost; Firecrawl billed separately in credits.",
    detail:
      "Standard model rates, excluding cache-write premiums. Unpriced charges are excluded from the subtotal.",
  },
  provider_reported: {
    label: "Model cost",
    note: "Provider-reported model cost; Firecrawl billed separately in credits.",
    detail: "Provider-reported model charges. Unpriced charges are excluded from the subtotal.",
  },
};

export function SessionCost({
  session,
}: {
  session: FunctionReturnType<typeof api.tasks.sessions.cost>;
}) {
  const { cost, usage } = session;
  const pricing = modelPricingCopy[cost.modelPricingBasis];
  const checksCost = session.checks.reduce((sum, check) => sum + (check.cost ?? 0), 0);
  const checksComplete = session.checks.every((check) => check.cost !== null);
  const pricedChecks = session.checks.some((check) => check.cost !== null);
  const complete = cost.totalEstimateUsd !== null && checksComplete && !session.research;
  const amount = (cost.totalEstimateUsd ?? cost.knownSubtotalUsd) + checksCost;
  const showAmount = cost.modelEstimateUsd !== null || pricedChecks || amount > 0;

  return (
    <details className="min-w-0 flex-1 text-xs">
      <summary className="w-fit cursor-pointer rounded py-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {showAmount
          ? `Cost · ${money.format(amount)}${complete ? " estimated" : " subtotal"}`
          : "Cost pending"}
      </summary>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 py-2 text-muted-foreground">
        {session.research && (
          <>
            <dt>Research Firecrawl</dt>
            <dd className="text-right tabular-nums">
              {session.research.reportedCredits === null
                ? "Credits not reported"
                : `${session.research.reportedCredits} credits`}
            </dd>
          </>
        )}
        {session.checks.length > 0 && (
          <>
            <dt>Checks</dt>
            <dd className="text-right tabular-nums">
              {checksComplete
                ? money.format(checksCost)
                : pricedChecks
                  ? `${money.format(checksCost)} + unpriced`
                  : "Unpriced"}
            </dd>
          </>
        )}
        <dt>{pricing.label}</dt>
        <dd className="text-right tabular-nums">
          {cost.modelEstimateUsd === null ? "Unpriced" : money.format(cost.modelEstimateUsd)}
        </dd>
        <dt>Web search</dt>
        <dd className="text-right tabular-nums">
          {cost.webSearchUsd === null ? "Unpriced" : money.format(cost.webSearchUsd)}
        </dd>
        <dt>Firecrawl</dt>
        <dd className="text-right tabular-nums">
          {cost.reportedBrowserCredits === 0 && cost.unreportedBrowserSessions > 0
            ? "Credits pending"
            : `${number.format(cost.reportedBrowserCredits)} credits`}
          {cost.reportedBrowserCredits > 0 && cost.unreportedBrowserSessions > 0 && " + pending"}
        </dd>
        {cost.browserSeconds > 0 && (
          <>
            <dt>Browser time</dt>
            <dd className="text-right tabular-nums">{number.format(cost.browserSeconds)}s</dd>
          </>
        )}
        {cost.browserEstimateUsd !== null && cost.browserEstimateUsd > 0 && (
          <>
            <dt>Browser estimate</dt>
            <dd className="text-right tabular-nums">{money.format(cost.browserEstimateUsd)}</dd>
          </>
        )}
        {usage && (
          <>
            <dt>Input tokens</dt>
            <dd className="text-right tabular-nums">{number.format(usage.inputTokens)}</dd>
            <dt>Cached input</dt>
            <dd className="text-right tabular-nums">
              {usage.cachedInputTokens == null
                ? "Not reported"
                : number.format(usage.cachedInputTokens)}
            </dd>
            <dt>Output tokens</dt>
            <dd className="text-right tabular-nums">{number.format(usage.outputTokens)}</dd>
          </>
        )}
      </dl>
      <p className="pb-2 text-muted-foreground" title={pricing.detail}>
        {pricing.note}
      </p>
    </details>
  );
}
