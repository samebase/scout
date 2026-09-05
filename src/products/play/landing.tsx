import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { PlayShell, ScoutPiece } from "./shell";

export function PlayLanding() {
  return (
    <PlayShell>
      <main id="main-content">
        <div className="play-hero">
          <div className="play-hero__copy">
            <h1>
              Add a player
              <br />
              to your <span>game.</span>
            </h1>
            <p>
              An AI player for your browser games. It's still learning, so expect a few questionable
              moves.
            </p>
            <Link to="/play/session" className="play-button">
              Invite Scout <ArrowRightIcon size={19} aria-hidden="true" />
            </Link>
          </div>
          <div className="lobby-preview" role="img" aria-label="Two game pieces, you and Scout">
            <div className="lobby-preview__tile lobby-preview__tile--you">
              <ScoutPiece className="scout-piece--you" />
              <span className="lobby-preview__name">You</span>
            </div>
            <span className="lobby-preview__connector" aria-hidden="true">
              +
            </span>
            <div className="lobby-preview__tile lobby-preview__tile--scout">
              <ScoutPiece />
              <span className="lobby-preview__name">Scout</span>
            </div>
          </div>
        </div>
        <section className="play-start" aria-label="How to play">
          <ol role="list">
            <li>
              <span className="play-start__number" aria-hidden="true">
                1
              </span>
              <div>
                <h2>Open a game</h2>
                <p>Start a room in a browser game.</p>
              </div>
            </li>
            <li>
              <span className="play-start__number" aria-hidden="true">
                2
              </span>
              <div>
                <h2>Invite Scout</h2>
                <p>Share the room link and any rules.</p>
              </div>
            </li>
            <li>
              <span className="play-start__number" aria-hidden="true">
                3
              </span>
              <div>
                <h2>Play together</h2>
                <p>Take your turns. Stop Scout whenever you need.</p>
              </div>
            </li>
          </ol>
        </section>
      </main>
    </PlayShell>
  );
}
