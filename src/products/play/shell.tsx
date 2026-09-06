import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils";
import { ScoutPiece } from "./scout-piece";

const playTheme = cn(
  "[--background:#fff] [--foreground:#253044] [--card:#fff] [--card-foreground:#253044] [--primary:#3558da] [--primary-foreground:#fff]",
  "[--secondary:#edf0f9] [--secondary-foreground:#253044] [--muted:#edf0f9] [--muted-foreground:#667080] [--accent:#edf0f9] [--accent-foreground:#253044]",
  "[--border:#dfe2e4] [--input:#dce0e6] [--ring:#3558da] [--destructive:#893d2b]",
);

export function PlayShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "min-h-dvh bg-play-paper font-play-body text-[15px] text-play-ink antialiased scheme-light",
        "[&_h1]:font-play-display [&_h2]:font-play-display [&_h3]:font-play-display [&_p]:leading-[1.7]",
        "[&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-3 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-offset-5 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-play-blue",
        "[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none",
        playTheme,
      )}
    >
      <a
        className="fixed -top-20 left-4 z-100 rounded-lg bg-play-blue px-5 py-3 text-white focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="mx-auto flex h-[112px] max-w-[1328px] items-center justify-between px-16 max-[1100px]:px-9 max-[760px]:h-[85px] max-[760px]:px-[25px]">
        <Link
          to="/play"
          className="flex items-center gap-[11px] font-play-display text-[35px] font-extrabold tracking-[-1.7px] max-[760px]:text-[30px]"
          aria-label="Scout Play home"
        >
          <ScoutPiece size="brand" />
          <span>
            scout <span className="font-medium">play</span>
            <span className="text-play-blue">.</span>
          </span>
        </Link>
        <nav aria-label="Product navigation">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-play-muted hover:text-play-blue max-[760px]:text-xs"
          >
            All products <ArrowUpRightIcon size={14} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
