import { createFileRoute } from "@tanstack/react-router";
import { ReviewLanding } from "../products/review/landing";

export const Route = createFileRoute("/review")({
  staticData: { access: "access_public" },
  head: () => ({
    meta: [
      { title: "Scout Review | A review you can watch" },
      {
        name: "description",
        content:
          "Scout Review explores product reviews with findings and a recording. Preview the direction.",
      },
    ],
  }),
  component: ReviewLanding,
});
