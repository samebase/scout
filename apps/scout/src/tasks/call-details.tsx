import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import type { WalkthroughReport } from "./model";

export function CallDetails({
  model,
  startedAt,
  finishedAt,
  cost,
  usage,
  request,
  response,
}: {
  model: string;
  startedAt: number;
  finishedAt: number | null;
  cost: { kind: "estimated" | "reported"; usd: number } | null;
  usage: Pick<
    NonNullable<Extract<WalkthroughReport["state"], { kind: "completed" }>["usage"]>,
    "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens"
  > | null;
  request: string | null;
  response: string | null;
}) {
  return (
    <PaneFrame
      header={<h2 className="border-b px-4 py-3 text-sm font-medium">Call details</h2>}
      content={
        <div className="space-y-5 p-4 text-sm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-words">{model}</dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd>
              <time dateTime={new Date(startedAt).toISOString()}>
                {new Date(startedAt).toLocaleString()}
              </time>
            </dd>
            {finishedAt !== null && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{((finishedAt - startedAt) / 1000).toFixed(1)}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Cost</dt>
            <dd>{cost === null ? "Not reported" : `$${cost.usd.toFixed(6)} ${cost.kind}`}</dd>
            {usage && (
              <>
                <dt className="text-muted-foreground">Input tokens</dt>
                <dd>{usage.inputTokens}</dd>
                <dt className="text-muted-foreground">Output tokens</dt>
                <dd>{usage.outputTokens}</dd>
                {usage.cachedInputTokens !== null && (
                  <>
                    <dt className="text-muted-foreground">Cached input tokens</dt>
                    <dd>{usage.cachedInputTokens}</dd>
                  </>
                )}
                {usage.reasoningTokens !== null && (
                  <>
                    <dt className="text-muted-foreground">Reasoning tokens</dt>
                    <dd>{usage.reasoningTokens}</dd>
                  </>
                )}
              </>
            )}
          </dl>
          {request !== null && <CallData title="Request" value={request} />}
          {response !== null && <CallData title="Response" value={response} />}
        </div>
      }
    />
  );
}

export function formatCallData(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // Failed provider calls may store a plain-text response.
    return value;
  }
}

function CallData({ title, value }: { title: string; value: string }) {
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{formatCallData(value)}</pre>
    </details>
  );
}
