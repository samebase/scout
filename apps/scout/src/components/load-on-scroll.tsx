import { useEffect, useRef } from "react";
import type { PaginationStatus } from "convex/react";

export function LoadOnScroll({ status, onLoad }: { status: PaginationStatus; onLoad: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || status !== "CanLoadMore") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        onLoad();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [status, onLoad]);

  if (status === "Exhausted") return null;
  return <div ref={sentinel} className="min-h-12" aria-busy={status === "LoadingMore"} />;
}
