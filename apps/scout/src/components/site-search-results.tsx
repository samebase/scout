import { LoaderCircleIcon } from "lucide-react";
import { Suspense, type ReactNode } from "react";

export function SiteSearchLoading() {
  return (
    <div
      role="status"
      aria-label="Searching sites"
      aria-busy="true"
      className="grid min-h-60 place-items-center text-muted-foreground"
    >
      <LoaderCircleIcon className="size-8 animate-spin" aria-hidden="true" />
      <span className="sr-only">Searching sites</span>
    </div>
  );
}

export function SiteSearchResults({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-60" aria-busy={pending}>
      <div inert={pending} className={pending ? "opacity-0" : undefined}>
        <Suspense fallback={pending ? null : <SiteSearchLoading />}>{children}</Suspense>
      </div>
      {pending && (
        <div className="absolute inset-0">
          <SiteSearchLoading />
        </div>
      )}
    </div>
  );
}
