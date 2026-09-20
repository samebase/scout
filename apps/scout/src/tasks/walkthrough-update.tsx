import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { Bubble, BubbleContent } from "#components/ui/bubble";
import { Message, MessageContent, MessageHeader } from "#components/ui/message";
import { ReviewChecks } from "#components/review-checks";
import { CallDetails, formatCallData } from "./call-details";
import type { WalkthroughReport } from "./model";

export function WalkthroughUpdateView({
  report,
}: {
  report: WalkthroughReport | null | undefined;
}) {
  return (
    <PaneFrame
      header={<h2 className="border-b px-6 py-3 text-sm font-medium">Walkthrough update</h2>}
      content={
        <section
          aria-label="Walkthrough update conversation"
          aria-busy={report === undefined}
          className="mx-auto w-full max-w-3xl space-y-6 p-6"
        >
          {report === null && (
            <p className="text-sm text-muted-foreground">Walkthrough update not found.</p>
          )}
          {report && (
            <>
              <Message align="end">
                <MessageContent>
                  <MessageHeader>Request</MessageHeader>
                  <Bubble align="end">
                    <BubbleContent>
                      <details>
                        <summary className="cursor-pointer">View request</summary>
                        <pre className="mt-3 whitespace-pre-wrap wrap-anywhere text-xs">
                          {formatCallData(report.request)}
                        </pre>
                      </details>
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
              <Message>
                <MessageContent>
                  <MessageHeader>Response</MessageHeader>
                  <Bubble variant="ghost">
                    <BubbleContent>
                      <WalkthroughResult state={report.state} />
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </>
          )}
        </section>
      }
    />
  );
}

function WalkthroughResult({ state }: { state: WalkthroughReport["state"] }) {
  switch (state.kind) {
    case "running":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Updating walkthrough…
        </p>
      );
    case "completed":
      return (
        <div className="space-y-5">
          <p className="whitespace-pre-wrap wrap-anywhere">{state.report.summary}</p>
          {state.report.checks && <ReviewChecks checks={state.report.checks} />}
          {state.report.sections.map((section, index) => (
            <section key={index} className="space-y-2">
              <h3 className="font-medium">{section.heading}</h3>
              <p className="whitespace-pre-wrap wrap-anywhere">{section.explanation}</p>
            </section>
          ))}
        </div>
      );
    case "failed":
      return (
        <p role="alert" className="whitespace-pre-wrap wrap-anywhere text-destructive">
          {state.error}
        </p>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function WalkthroughUpdateInspector({
  report,
}: {
  report: WalkthroughReport | null | undefined;
}) {
  if (!report) return null;
  const finished = report.state.kind === "running" ? null : report.state;
  const cost = finished?.usage?.costUsd;
  return (
    <CallDetails
      model={report.model}
      startedAt={report.startedAt}
      finishedAt={finished?.finishedAt ?? null}
      cost={cost == null ? null : { kind: "reported", usd: cost }}
      usage={finished?.usage ?? null}
      request={report.request}
      response={finished?.response ?? null}
    />
  );
}
