import { createFileRoute } from "@tanstack/react-router";
import { HumanHandoffPage } from "#components/human-handoff-page";

export const Route = createFileRoute("/handoff/$handoffId")({
  staticData: { access: "access_public" },
  head: () => ({
    meta: [{ title: "Human handoff | Scout" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: HandoffRoute,
});

function HandoffRoute() {
  const { handoffId } = Route.useParams();
  return <HumanHandoffPage handoffId={handoffId} />;
}
