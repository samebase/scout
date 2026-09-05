import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, FocusIcon } from "lucide-react";
import type { ReactNode } from "react";
import "./styles.css";

export function ReviewShell({ children }: { children: ReactNode }) {
  return (
    <div className="review-site">
      <a href="#main-content" className="review-skip">
        Skip to content
      </a>
      <header className="review-header">
        <Link to="/review" className="review-brand" aria-label="Scout Review home">
          <FocusIcon size={29} strokeWidth={1.5} aria-hidden="true" />
          <span>
            scout <span className="review-brand__product">review</span>
          </span>
        </Link>
        <div className="review-header__end">
          <span className="review-preview-tag">Design preview</span>
          <Link to="/" className="review-text-link">
            All products <ArrowUpRightIcon size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
