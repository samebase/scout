import { createFileRoute } from "@tanstack/react-router";
import { PlayLanding } from "../products/play/landing";

export const Route = createFileRoute("/play/")({
  head: () => ({
    meta: [
      { title: "Scout Play | Add a player to your game" },
      {
        name: "description",
        content: "Invite Scout, an experimental AI player, to your browser game.",
      },
    ],
  }),
  component: PlayLanding,
});
