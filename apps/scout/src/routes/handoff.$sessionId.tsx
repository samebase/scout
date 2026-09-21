import { createFileRoute } from "@tanstack/react-router";
import { HumanHandoffPage } from "../components/human-handoff-page";

export const Route = createFileRoute("/handoff/$sessionId")({
  ssr: false,
  staticData: { access: "access_public" },
  head: () => ({
    meta: [
      { title: "Help your Scout continue | TrailScout" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: HandoffRoute,
});

function HandoffRoute() {
  const { sessionId } = Route.useParams();
  return <HumanHandoffPage key={sessionId} sessionId={sessionId} />;
}
