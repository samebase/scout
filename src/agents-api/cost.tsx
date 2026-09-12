import type { Session } from "./model";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function SessionCost({ session }: { session: Session }) {
  const { cost, usage } = session;
  const complete = cost.totalEstimateUsd !== null;
  const amount = cost.totalEstimateUsd ?? cost.knownSubtotalUsd;
  const showAmount = cost.modelEstimateUsd !== null || amount > 0;

  return (
    <details className="min-w-0 flex-1 text-xs">
      <summary className="w-fit cursor-pointer rounded py-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {showAmount
          ? `Cost · ${money.format(amount)}${complete ? " estimated" : " subtotal"}`
          : "Cost pending"}
      </summary>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 py-2 text-muted-foreground">
        <dt>Model estimate</dt>
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
      <p
        className="pb-2 text-muted-foreground"
        title="Standard model rates, excluding cache-write premiums. Unpriced charges are excluded from the subtotal."
      >
        Estimated OpenAI cost; Firecrawl billed separately in credits.
      </p>
    </details>
  );
}
