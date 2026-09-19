import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { Bubble, BubbleContent } from "#components/ui/bubble";
import { Message, MessageContent } from "#components/ui/message";
import { ToolActivityRow, ToolValue } from "#components/tool-activity";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "#components/ui/message-scroller";
import type { Session, SessionItem } from "./model";

export function Transcript({ sessionId }: { sessionId: Session["_id"] }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tasks.sessions.listItems,
    { sessionId },
    { initialNumItems: 50 },
  );
  const items = results
    .filter((item) => item.kind !== "reasoning" || item.text.trim().length > 0)
    .toSorted((left, right) => left.sequence - right.sequence || left._id.localeCompare(right._id));

  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Session transcript" tabIndex={0}>
          <MessageScrollerContent
            className="gap-2 p-4 sm:p-6"
            aria-busy={status === "LoadingFirstPage" || status === "LoadingMore"}
          >
            {(status === "CanLoadMore" || status === "LoadingMore") && (
              <Button
                variant="ghost"
                className="self-center"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(50)}
              >
                Load more
              </Button>
            )}
            {items.map((item) => (
              <MessageScrollerItem key={item._id}>
                <TranscriptItem item={item} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function TranscriptItem({ item }: { item: SessionItem }) {
  if (item.tool) {
    return (
      <ToolActivityRow tool={item.tool}>
        {item.details && <ToolValue label="Provider record" value={item.details} />}
      </ToolActivityRow>
    );
  }
  const content = (
    <>
      {item.text && (
        <p className="whitespace-pre-wrap wrap-anywhere leading-relaxed">{item.text}</p>
      )}
      {item.details && (
        <details className="mt-2 min-w-0">
          <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Details
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap wrap-anywhere">
            {item.details}
          </pre>
        </details>
      )}
    </>
  );

  return (
    <article className="my-2 min-w-0 select-text text-sm">
      {item.kind === "reasoning" ? (
        <details>
          <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Reasoning
          </summary>
          <div className="mt-2">{content}</div>
        </details>
      ) : item.kind === "user" || item.kind === "assistant" ? (
        <Message align={item.kind === "user" ? "end" : "start"}>
          <MessageContent>
            <Bubble
              variant={item.kind === "user" ? "default" : "ghost"}
              align={item.kind === "user" ? "end" : "start"}
            >
              <BubbleContent>{content}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      ) : (
        <>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {item.kind.replaceAll("_", " ")}
          </p>
          {content}
        </>
      )}
    </article>
  );
}
