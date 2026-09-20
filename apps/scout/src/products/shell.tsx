import type { ReactNode } from "react";
import { cn } from "#lib/utils";

export function ProductShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "min-h-[calc(100dvh-4rem)] bg-background text-foreground [&_p]:leading-[1.7]",
        "[&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-3 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-offset-5 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-primary",
        "[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none",
      )}
    >
      <a
        className="fixed -top-20 left-4 z-100 rounded-lg bg-primary px-5 py-3 text-primary-foreground focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      {children}
    </div>
  );
}
