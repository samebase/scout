import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { PlayPage } from "../products/play/page";
import { PlayShell } from "../products/play/shell";

export const Route = createFileRoute("/play/session")({
  validateSearch: z.object({ thread: z.string().min(1).optional() }),
  head: () => ({ meta: [{ title: "Play with Scout" }, { name: "robots", content: "noindex" }] }),
  component: PlayPage,
  errorComponent: () => (
    <PlayShell>
      <main id="main-content" className="play-route-message">
        <h1>Couldn't open this session</h1>
        <p>The link may be unavailable, or the connection was interrupted.</p>
        <Link to="/play/session" search={{}} className="play-button">
          Back to play
        </Link>
      </main>
    </PlayShell>
  ),
});
