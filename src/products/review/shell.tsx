import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, FocusIcon } from "lucide-react";
import type { ReactNode } from "react";

export function ReviewShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-review-paper font-review text-[15px] text-review-ink antialiased scheme-light [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-5 [&_a:focus-visible]:outline-review-accent motion-reduce:[&_*]:transition-none">
      <a
        href="#main-content"
        className="fixed -top-20 left-5 z-100 bg-review-ink px-5 py-3 text-white focus:top-4"
      >
        Skip to content
      </a>
      <header className="mx-auto flex h-[100px] max-w-[1280px] items-center justify-between border-b border-review-line px-16 max-[1100px]:px-9 max-[760px]:h-[90px] max-[760px]:px-6">
        <Link
          to="/review"
          className="flex items-center gap-3 text-[29px] font-medium tracking-[-1px] max-[760px]:gap-[9px] max-[760px]:text-[26px]"
          aria-label="Scout Review home"
        >
          <FocusIcon size={29} strokeWidth={1.5} className="max-[760px]:w-6" aria-hidden="true" />
          <span>
            scout <span className="font-normal">review</span>
          </span>
        </Link>
        <div className="flex items-center gap-7 max-[760px]:flex-col-reverse max-[760px]:items-end max-[760px]:gap-2">
          <span className="rounded-[2px] border border-[#ccd8d1] px-[7px] py-1 font-review-mono text-[10px] text-[#6b7b74] max-[760px]:px-[5px] max-[760px]:py-[3px] max-[760px]:text-[8px]">
            Design preview
          </span>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs text-review-muted hover:text-review-ink max-[760px]:gap-1 max-[760px]:text-[11px]"
          >
            All products <ArrowUpRightIcon size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
