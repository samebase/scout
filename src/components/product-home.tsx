import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ArrowUpRightIcon, FocusIcon } from "lucide-react";
import { ScoutPiece } from "../products/play/shell";
import "../product-home.css";
import "../products/review/styles.css";

export function ProductHome() {
  return (
    <div className="product-home">
      <a className="home-skip" href="#main-content">
        Skip to content
      </a>
      <header className="home-header">
        <Link to="/" className="home-brand" aria-label="Scout products">
          scout.
        </Link>
        <Link to="/chats" className="home-lab">
          Lab <ArrowUpRightIcon size={14} aria-hidden="true" />
        </Link>
      </header>
      <main id="main-content" className="home-main">
        <h1>What are we doing today?</h1>
        <div className="home-products">
          <Link
            to="/play"
            className="home-product home-product--play"
            aria-label="Explore Scout Play"
          >
            <div className="home-play-art" aria-hidden="true">
              <div className="home-play-tile home-play-tile--you">
                <ScoutPiece className="scout-piece--you" />
              </div>
              <span className="home-play-plus">+</span>
              <div className="home-play-tile home-play-tile--scout">
                <ScoutPiece />
              </div>
            </div>
            <div className="home-product__copy">
              <h2>
                Scout Play<span>.</span>
              </h2>
              <p>One more player for your browser game.</p>
              <span className="home-product__action">
                Explore Play <ArrowRightIcon size={18} aria-hidden="true" />
              </span>
            </div>
          </Link>
          <Link
            to="/review"
            className="home-product home-product--review"
            aria-label="Explore Scout Review"
          >
            <div className="home-review-art" aria-hidden="true">
              <div className="home-review-paper">
                <div className="home-review-paper__header">
                  <FocusIcon size={16} /> <span>REVIEW / SIGNUP FLOW</span>
                </div>
                <span className="home-review-paper__label">OBSERVATION</span>
                <strong>A clearer way forward.</strong>
                <div className="home-review-highlight">
                  <span />
                  <span />
                </div>
                <div className="home-review-paper__rule" />
                <div className="home-review-paper__rule home-review-paper__rule--short" />
              </div>
            </div>
            <div className="home-product__copy">
              <div className="home-product__title">
                <h2>Scout Review</h2>
                <span className="home-preview-label">Preview</span>
              </div>
              <p>A fresh look at your product, backed by a recording.</p>
              <span className="home-product__action">
                Explore Review <ArrowRightIcon size={18} aria-hidden="true" />
              </span>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
