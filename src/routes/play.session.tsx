import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { PlayPage } from "../products/play/page";
import { PlayShell } from "../products/play/shell";
import { productButtonVariants } from "../products/ui";
import { playRouteMessage } from "../products/play/ui";

export const Route = createFileRoute("/play/session")({
  validateSearch: z.object({ thread: z.string().min(1).optional() }),
  head: () => ({ meta: [{ title: "Play with Scout" }, { name: "robots", content: "noindex" }] }),
  component: PlayPage,
  errorComponent: () => (
    <PlayShell>
      <main id="main-content" className={playRouteMessage}>
        <h1 className="text-[30px]">Couldn't open this session</h1>
        <p className="text-play-muted">
          The link may be unavailable, or the connection was interrupted.
        </p>
        <Link to="/play/session" search={{}} className={productButtonVariants({ variant: "play" })}>
          Back to play
        </Link>
      </main>
    </PlayShell>
  ),
});
