import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CameraIcon, GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#lib/utils";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";

type Site = NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;
type ImageUrl = NonNullable<FunctionReturnType<typeof api.scout.sitePreviews.imageUrl>>;
const imageUrls = new Map<string, ImageUrl>();

export function SitePreview({ site, className }: { site: Site; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative aspect-[8/5] overflow-hidden bg-muted", className)}
    >
      {site.preview?.kind === "ready" ? (
        <LandingImage
          key={`${site.hostname}:${site.preview.capturedAt}`}
          site={site.hostname}
          capturedAt={site.preview.capturedAt}
        />
      ) : (
        <EmptyPreview />
      )}
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="grid size-full place-items-center">
      <GlobeIcon className="size-8 text-muted-foreground/35" />
    </div>
  );
}

export function SitePreviewCapture({ site }: { site: Site }) {
  const capture = useAction(api.scout.sitePreviews.capture);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (site.preview?.kind === "ready") return null;
  const busy = pending || site.preview?.kind === "capturing";
  return (
    <div className="text-right">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setPending(true);
          setError(null);
          void capture({ site: site.hostname })
            .catch(() => {
              setError("Couldn't capture the preview.");
            })
            .finally(() => setPending(false));
        }}
      >
        <CameraIcon aria-hidden="true" />
        {busy
          ? "Capturing preview…"
          : site.preview?.kind === "failed"
            ? "Retry preview"
            : "Capture preview"}
      </Button>
      {(error || site.preview?.kind === "failed") && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error ?? (site.preview?.kind === "failed" ? site.preview.message : null)}
        </p>
      )}
    </div>
  );
}

function LandingImage({ site, capturedAt }: { site: string; capturedAt: number }) {
  const imageUrl = useAction(api.scout.sitePreviews.imageUrl);
  const target = useRef<HTMLDivElement>(null);
  const key = `${site}:${capturedAt}`;
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; image: ImageUrl } | { kind: "failed" }
  >(() => {
    const cached = imageUrls.get(key);
    return cached && cached.expiresAtMs > Date.now()
      ? { kind: "ready", image: cached }
      : { kind: "loading" };
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let cancelled = false;
    const cached = imageUrls.get(key);
    if (cached && cached.expiresAtMs > Date.now()) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void imageUrl({ site }).then(
          (image) => {
            if (cancelled) return;
            if (image) {
              imageUrls.set(key, image);
              setState({ kind: "ready", image });
            } else setState({ kind: "failed" });
          },
          () => {
            if (!cancelled) setState({ kind: "failed" });
          },
        );
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [imageUrl, key, site]);
  return (
    <div ref={target} className="size-full">
      {state.kind === "ready" ? (
        <img
          src={state.image.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top"
          onError={() => {
            imageUrls.delete(key);
            setState({ kind: "failed" });
          }}
        />
      ) : (
        <EmptyPreview />
      )}
    </div>
  );
}
