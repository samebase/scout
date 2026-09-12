import type { ReactNode } from "react";
import { cn } from "#lib/utils";
import { AppNavigation } from "#components/app-navigation";
import type { ProductKind } from "./conversation/model";

const playTheme = cn(
  "[--background:#fafaf6] [--foreground:#253044] [--card:#fff] [--card-foreground:#253044] [--primary:#3558da] [--primary-foreground:#fff]",
  "[--secondary:#edf0f9] [--secondary-foreground:#253044] [--muted:#edf0f9] [--muted-foreground:#667080] [--accent:#edf0f9] [--accent-foreground:#253044]",
  "[--border:#dfe2e4] [--input:#dce0e6] [--ring:#3558da] [--destructive:#893d2b]",
  "[--product-panel-radius:22px] [--product-control-radius:14px] [--product-message-radius:20px_20px_4px_20px]",
  "font-play-body [&_h1]:font-play-display [&_h2]:font-play-display [&_h3]:font-play-display",
);

const reviewTheme = cn(
  "[--background:#f1f4f2] [--foreground:#203c36] [--card:#fff] [--card-foreground:#203c36] [--primary:#28584d] [--primary-foreground:#fff]",
  "[--secondary:#e6edeb] [--secondary-foreground:#203c36] [--muted:#e6edeb] [--muted-foreground:#5c7065] [--accent:#e6edeb] [--accent-foreground:#203c36]",
  "[--border:#d8e0dc] [--input:#c5d1ca] [--ring:#28584d] [--destructive:#893d2b] [--radius:6px]",
  "[--product-panel-radius:8px] [--product-control-radius:6px] [--product-message-radius:8px]",
  "font-review [&_h1]:font-review [&_h2]:font-review [&_h3]:font-review",
);

export function ProductShell({
  children,
  product,
}: {
  children: ReactNode;
  product: ProductKind | null;
}) {
  const isReview = product === "review";
  return (
    <div
      className={cn(
        "min-h-dvh bg-background text-[15px] text-foreground antialiased scheme-light [&_p]:leading-[1.7]",
        "[&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-3 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-offset-5 [&_:is(a,button,summary,input,textarea,select):focus-visible]:outline-primary",
        "[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none",
        isReview ? reviewTheme : playTheme,
      )}
    >
      <a
        className="fixed -top-20 left-4 z-100 rounded-lg bg-primary px-5 py-3 text-white focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <AppNavigation />
      {children}
    </div>
  );
}
