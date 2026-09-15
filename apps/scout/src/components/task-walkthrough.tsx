import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ImageIcon,
  MaximizeIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog";

type Walkthrough = NonNullable<FunctionReturnType<typeof api.agentsApi.walkthrough.get>>;
type Capture = Walkthrough["captures"][number];
type ImageUrl = NonNullable<FunctionReturnType<typeof api.agentsApi.screenshots.imageUrl>>;
type ImageState =
  | { kind: "loading" }
  | { kind: "ready"; image: ImageUrl }
  | { kind: "failed"; message: string };

export function TaskWalkthrough({ sessionId }: { sessionId: Id<"agentsApiSessions"> }) {
  return <SessionWalkthrough key={sessionId} sessionId={sessionId} />;
}

function SessionWalkthrough({ sessionId }: { sessionId: Id<"agentsApiSessions"> }) {
  const result = useQuery(api.agentsApi.walkthrough.get, { sessionId });
  const [selection, setSelection] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);

  function select(index: number) {
    setSelection(index);
    if (scroll.current) scroll.current.scrollTop = 0;
  }

  if (result === undefined) {
    return <WalkthroughNotice title="Loading walkthrough…" loading />;
  }
  if (result === null) {
    return (
      <WalkthroughNotice title="Walkthrough unavailable">
        This task is private or no longer available.
      </WalkthroughNotice>
    );
  }

  const { walkthrough, captures } = result;
  const steps = walkthrough
    ? walkthrough.sections.flatMap((section) =>
        section.captureIds.map((id) => ({
          heading: section.heading,
          explanation: section.explanation,
          capture: captures.find((capture) => capture.id === id) ?? null,
        })),
      )
    : captures.map((capture, index) => ({
        heading: `Moment ${index + 1}`,
        explanation: capture.note,
        capture,
      }));
  const index = Math.min(selection, Math.max(0, steps.length - 1));
  const step = steps.at(index);

  if (!step) {
    return (
      <WalkthroughNotice title="No screenshots yet">
        {walkthrough?.summary ||
          "Screenshots will appear here as Scout explores. The finished walkthrough brings them together."}
      </WalkthroughNotice>
    );
  }

  return (
    <section aria-label="Task walkthrough" className="flex h-full min-h-0 min-w-0 flex-col">
      <div ref={scroll} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
          <header className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {walkthrough ? "Walkthrough" : "Captured so far"}
            </p>
            {walkthrough && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
                {walkthrough.summary}
              </p>
            )}
          </header>
          <div aria-live="polite" aria-atomic="true" className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{step.heading}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere text-muted-foreground">
              {step.explanation}
            </p>
          </div>
          {step.capture ? (
            <CaptureImage key={step.capture.id} capture={step.capture} heading={step.heading} />
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No screenshot for this step.
            </p>
          )}
        </div>
      </div>
      <nav
        aria-label="Walkthrough steps"
        className="flex shrink-0 items-center justify-between gap-2 border-t bg-background px-3 py-2 sm:px-6"
      >
        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => select(index - 1)}>
          <ArrowLeftIcon aria-hidden="true" /> Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {index + 1} of {steps.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={index === steps.length - 1}
          onClick={() => select(index + 1)}
        >
          Next <ArrowRightIcon aria-hidden="true" />
        </Button>
      </nav>
    </section>
  );
}

function WalkthroughNotice({
  title,
  loading = false,
  children,
}: {
  title: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="Task walkthrough"
      className="flex h-full min-h-0 items-center justify-center p-6 sm:p-10"
    >
      <div className="max-w-sm space-y-3 text-center">
        <ImageIcon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold" role={loading ? "status" : undefined}>
          {title}
        </h2>
        {children && <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </section>
  );
}

function CaptureImage({ capture, heading }: { capture: Capture; heading: string }) {
  switch (capture.state.kind) {
    case "pending":
      return (
        <p
          role="status"
          className="rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground"
        >
          Saving screenshot…
        </p>
      );
    case "failed":
      return (
        <div role="alert" className="space-y-2 rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium">Screenshot couldn’t be saved</p>
          <p className="wrap-anywhere text-muted-foreground">{capture.state.message}</p>
          <p className="text-muted-foreground">You can continue to the next moment.</p>
        </div>
      );
    case "ready":
      return (
        <OriginalImage
          screenshotId={capture.id}
          metadata={capture.state.metadata}
          note={capture.note}
          heading={heading}
        />
      );
    default: {
      const exhaustive: never = capture.state;
      return exhaustive;
    }
  }
}

function OriginalImage({
  screenshotId,
  metadata,
  note,
  heading,
}: {
  screenshotId: Capture["id"];
  metadata: Extract<Capture["state"], { kind: "ready" }>["metadata"];
  note: Capture["note"];
  heading: string;
}) {
  const imageUrl = useAction(api.agentsApi.screenshots.imageUrl);
  const [state, setState] = useState<ImageState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const imageErrors = useRef(0);
  const refreshing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void imageUrl({ screenshotId }).then(
      (image) => {
        if (cancelled) return;
        refreshing.current = false;
        setState(
          image && image.expiresAtMs > Date.now()
            ? { kind: "ready", image }
            : { kind: "failed", message: "This screenshot is no longer available." },
        );
      },
      () => {
        if (cancelled) return;
        refreshing.current = false;
        setState({ kind: "failed", message: "Couldn’t load this screenshot. Try again." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl, screenshotId, attempt]);

  const renew = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    setAttempt((value) => value + 1);
  }, []);

  const refreshAfterError = useCallback(() => {
    if (refreshing.current) return;
    if (imageErrors.current >= 1) {
      setState({ kind: "failed", message: "Couldn’t load this screenshot. Try again." });
      return;
    }
    imageErrors.current += 1;
    setState({ kind: "loading" });
    renew();
  }, [renew]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const timer = window.setTimeout(renew, Math.max(0, state.image.expiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state, renew]);

  const sourceUrl = URL.canParse(metadata.url) ? new URL(metadata.url) : null;
  const source =
    sourceUrl?.protocol === "https:" || sourceUrl?.protocol === "http:" ? sourceUrl : null;
  const image =
    state.kind === "ready" ? (
      <img
        src={state.image.url}
        alt={note || heading}
        width={metadata.width}
        height={metadata.height}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={refreshAfterError}
        className="block h-auto w-full"
      />
    ) : (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p role={state.kind === "failed" ? "alert" : "status"}>
          {state.kind === "failed" ? state.message : "Loading screenshot…"}
        </p>
        {state.kind === "failed" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              imageErrors.current = 0;
              refreshing.current = true;
              setState({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        )}
      </div>
    );

  return (
    <div ref={setContainer}>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <figure className="space-y-2">
          <figcaption className="flex min-w-0 items-center justify-between gap-3">
            {source ? (
              <a
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                title={source.href}
              >
                <span className="truncate">
                  {source.host}
                  {source.pathname === "/" ? "" : source.pathname}
                </span>
                <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="truncate text-xs text-muted-foreground">{metadata.title}</span>
            )}
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={state.kind !== "ready"}>
                <MaximizeIcon aria-hidden="true" /> Expand
              </Button>
            </DialogTrigger>
          </figcaption>
          <div className="overflow-hidden rounded-lg border bg-muted/20">{image}</div>
        </figure>
        <DialogContent
          container={container}
          className="flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-[96vw] flex-col gap-3 p-3 sm:max-w-[96vw] sm:p-5"
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>{note}</DialogDescription>
          </DialogHeader>
          <div
            className="min-h-0 overflow-auto rounded-md border"
            tabIndex={0}
            aria-label="Full-size screenshot"
          >
            {state.kind === "ready" ? (
              <img
                src={state.image.url}
                alt={note || heading}
                width={metadata.width}
                height={metadata.height}
                referrerPolicy="no-referrer"
                onError={refreshAfterError}
                className="block max-w-none"
              />
            ) : (
              image
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
