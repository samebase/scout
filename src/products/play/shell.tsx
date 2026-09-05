import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import "./styles.css";

export function ScoutPiece({ className = "" }: { className?: string }) {
  return (
    <span className={`scout-piece ${className}`} aria-hidden="true">
      <span className="scout-piece__eyes">
        <i />
        <i />
      </span>
    </span>
  );
}

export function PlayShell({ children }: { children: ReactNode }) {
  return (
    <div className="play-site">
      <a className="play-skip" href="#main-content">
        Skip to content
      </a>
      <header className="play-header">
        <Link to="/play" className="play-brand" aria-label="Scout Play home">
          <ScoutPiece />
          <span>
            scout <span className="play-brand__product">play</span>
            <span className="play-brand__period">.</span>
          </span>
        </Link>
        <nav aria-label="Product navigation">
          <Link to="/" className="play-nav-link">
            All products <ArrowUpRightIcon size={14} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
