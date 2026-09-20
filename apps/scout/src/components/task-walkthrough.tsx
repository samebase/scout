import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ImageIcon,
  MaximizeIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "#components/ui/button";
import { ReviewChecks, ReviewCheckSummary } from "#components/review-checks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog";

type Walkthrough = NonNullable<FunctionReturnType<typeof api.tasks.walkthrough.get>>;
type Capture = Walkthrough["captures"][number];
type ImageUrl = NonNullable<FunctionReturnType<typeof api.tasks.screenshots.imageUrl>>;
type ImageState =
  | { kind: "loading" }
  | { kind: "ready"; image: ImageUrl }
  | { kind: "failed"; message: string };

export function TaskWalkthrough({ sessionId }: { sessionId: Id<"agentsApiSessions"> }) {
  return <SessionWalkthrough key={sessionId} sessionId={sessionId} />;
}

function SessionWalkthrough({ sessionId }: { sessionId: Id<"agentsApiSessions"> }) {
  const result = useQuery(api.tasks.walkthrough.get, { sessionId });
  const imageUrls = useScreenshotUrls();
  const [selection, setSelection] = useState(0);
  const [loadedCaptureId, setLoadedCaptureId] = useState<Capture["id"] | null>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const captionScroll = useRef<HTMLDivElement>(null);
  const screenshotPanel = useRef<HTMLDivElement>(null);
  const screenshotTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (screenshotTop.current !== null && scroll.current && screenshotPanel.current) {
      scroll.current.scrollTop +=
        screenshotPanel.current.getBoundingClientRect().top - screenshotTop.current;
    }
    screenshotTop.current = null;
  }, [selection]);

  function select(index: number) {
    if (scroll.current && screenshotPanel.current && scroll.current.scrollTop > 0) {
      const top = screenshotPanel.current.getBoundingClientRect().top;
      if (top < scroll.current.getBoundingClientRect().bottom) screenshotTop.current = top;
    }
    setSelection(index);
    if (captionScroll.current) captionScroll.current.scrollTop = 0;
  }

  if (result === undefined) {
    return <section aria-label="Task walkthrough" aria-busy="true" className="h-full min-h-0" />;
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
  const nextCapture = steps.at(index + 1)?.capture;

  if (!step) {
    return (
      <WalkthroughNotice title="No screenshots saved">
        Read the chat for this task’s findings.
      </WalkthroughNotice>
    );
  }

  return (
    <section
      ref={setDialogContainer}
      aria-label="Task walkthrough"
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div
        ref={scroll}
        className="@container/walkthrough min-h-0 flex-1 overflow-auto overscroll-y-contain"
      >
        <div className="grid w-full gap-5 p-4 @2xl/walkthrough:h-full @2xl/walkthrough:min-h-0 @2xl/walkthrough:grid-cols-[minmax(0,min(33%,24rem))_minmax(0,1fr)] @2xl/walkthrough:grid-rows-[minmax(0,1fr)] @2xl/walkthrough:gap-6 @2xl/walkthrough:p-5">
          <div
            ref={captionScroll}
            className="min-w-0 space-y-5 @2xl/walkthrough:min-h-0 @2xl/walkthrough:overflow-auto @2xl/walkthrough:pr-1"
          >
            <header className="space-y-2">
              {!walkthrough && (
                <p className="text-xs font-medium text-muted-foreground">Captured so far</p>
              )}
              {walkthrough?.checks && <ReviewCheckSummary checks={walkthrough.checks} />}
              {walkthrough && index === 0 && (
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
            {walkthrough?.checks && <ReviewChecks checks={walkthrough.checks} />}
          </div>
          <div ref={screenshotPanel} className="min-w-0 @2xl/walkthrough:min-h-0">
            {step.capture ? (
              <CaptureImage
                key={step.capture.id}
                capture={step.capture}
                heading={step.heading}
                dialogContainer={dialogContainer}
                imageUrls={imageUrls}
                onLoad={setLoadedCaptureId}
              />
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No screenshot for this step.
              </p>
            )}
          </div>
        </div>
      </div>
      <nav aria-label="Walkthrough steps" className="shrink-0 border-t bg-background">
        <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => select(index - 1)}
          >
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
        </div>
      </nav>
      {step.capture?.id === loadedCaptureId &&
        nextCapture?.state.kind === "ready" &&
        nextCapture.id !== loadedCaptureId && (
          <PreloadScreenshot
            key={nextCapture.id}
            screenshotId={nextCapture.id}
            imageUrls={imageUrls}
          />
        )}
    </section>
  );
}

function useScreenshotUrls() {
  const imageUrl = useAction(api.tasks.screenshots.imageUrl);
  return useMemo(() => {
    const urls = new Map<Capture["id"], ImageUrl>();
    const requests = new Map<Capture["id"], Promise<ImageUrl | null>>();
    function peek(screenshotId: Capture["id"]) {
      const image = urls.get(screenshotId);
      return image && image.expiresAtMs > Date.now() ? image : null;
    }
    return {
      peek,
      invalidate: (screenshotId: Capture["id"]) => urls.delete(screenshotId),
      load(screenshotId: Capture["id"]) {
        const cached = peek(screenshotId);
        if (cached) return Promise.resolve(cached);
        const pending = requests.get(screenshotId);
        if (pending) return pending;
        const request = imageUrl({ screenshotId })
          .then((image) => {
            if (image) urls.set(screenshotId, image);
            else urls.delete(screenshotId);
            return image;
          })
          .finally(() => requests.delete(screenshotId));
        requests.set(screenshotId, request);
        return request;
      },
    };
  }, [imageUrl]);
}

function PreloadScreenshot({
  screenshotId,
  imageUrls,
}: {
  screenshotId: Capture["id"];
  imageUrls: ReturnType<typeof useScreenshotUrls>;
}) {
  const [image, setImage] = useState<ImageUrl | null>(() => imageUrls.peek(screenshotId));
  useEffect(() => {
    let cancelled = false;
    void imageUrls.load(screenshotId).then(
      (image) => {
        if (!cancelled) setImage(image);
      },
      () => {
        // Selecting this screenshot can request it again and show any failure.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrls, screenshotId]);
  return image ? (
    <img hidden alt="" src={image.url} referrerPolicy="no-referrer" fetchPriority="low" />
  ) : null;
}

function WalkthroughNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section
      aria-label="Task walkthrough"
      className="flex h-full min-h-0 items-center justify-center p-6 sm:p-10"
    >
      <div className="max-w-sm space-y-3 text-center">
        <ImageIcon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold">{title}</h2>
        {children && <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </section>
  );
}

function CaptureImage({
  capture,
  heading,
  dialogContainer,
  imageUrls,
  onLoad,
}: {
  capture: Capture;
  heading: string;
  dialogContainer: HTMLElement | null;
  imageUrls: ReturnType<typeof useScreenshotUrls>;
  onLoad: (screenshotId: Capture["id"]) => void;
}) {
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
          dialogContainer={dialogContainer}
          imageUrls={imageUrls}
          onLoad={() => onLoad(capture.id)}
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
  dialogContainer,
  imageUrls,
  onLoad,
}: {
  screenshotId: Capture["id"];
  metadata: Extract<Capture["state"], { kind: "ready" }>["metadata"];
  note: Capture["note"];
  heading: string;
  dialogContainer: HTMLElement | null;
  imageUrls: ReturnType<typeof useScreenshotUrls>;
  onLoad: () => void;
}) {
  const [state, setState] = useState<ImageState>(() => {
    const image = imageUrls.peek(screenshotId);
    return image ? { kind: "ready", image } : { kind: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const imageErrors = useRef(0);
  const refreshing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void imageUrls.load(screenshotId).then(
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
        setState((current) =>
          current.kind === "ready"
            ? current
            : { kind: "failed", message: "Couldn’t load this screenshot. Try again." },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrls, screenshotId, attempt]);

  const renew = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    imageUrls.invalidate(screenshotId);
    setAttempt((value) => value + 1);
  }, [imageUrls, screenshotId]);

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
        onLoad={onLoad}
        onError={refreshAfterError}
        className="block h-auto w-full @2xl/walkthrough:h-full @2xl/walkthrough:min-h-0 @2xl/walkthrough:object-contain"
      />
    ) : state.kind === "failed" ? (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p role="alert">{state.message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            imageErrors.current = 0;
            refreshing.current = true;
            imageUrls.invalidate(screenshotId);
            setState({ kind: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    ) : null;

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <figure className="flex min-w-0 flex-col gap-2 @2xl/walkthrough:h-full @2xl/walkthrough:min-h-0">
        <figcaption className="flex min-w-0 shrink-0 items-center justify-between gap-3">
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
        <div
          aria-busy={state.kind === "loading"}
          style={{ aspectRatio: `${metadata.width} / ${metadata.height}` }}
          className="overflow-hidden rounded-lg border bg-muted/20 @2xl/walkthrough:flex @2xl/walkthrough:aspect-auto! @2xl/walkthrough:min-h-0 @2xl/walkthrough:flex-1 @2xl/walkthrough:items-center @2xl/walkthrough:justify-center"
        >
          {image}
        </div>
      </figure>
      <DialogContent
        container={dialogContainer}
        className="flex h-[90dvh] max-h-[94dvh] w-[calc(100%-1rem)] max-w-[96vw] flex-col gap-3 p-3 sm:max-w-[96vw] sm:p-5"
      >
        <DialogHeader className="max-h-[min(25dvh,10rem)] shrink-0 overflow-auto overscroll-contain pr-8">
          <DialogTitle className="wrap-anywhere">{heading}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap wrap-anywhere">
            {note}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/20">
          {state.kind === "ready" ? (
            <img
              src={state.image.url}
              alt={note || heading}
              width={metadata.width}
              height={metadata.height}
              referrerPolicy="no-referrer"
              onError={refreshAfterError}
              className="block h-full max-h-[70dvh] w-full max-w-full object-contain"
            />
          ) : (
            image
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
