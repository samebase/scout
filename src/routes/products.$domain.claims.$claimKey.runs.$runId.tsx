import { createFileRoute } from "@tanstack/react-router";
import { ClaimRunWorkspace } from "#components/claim-run-workspace";

export const Route = createFileRoute("/products/$domain/claims/$claimKey/runs/$runId")({
  component: ClaimRunPage,
});

function ClaimRunPage() {
  const { claimKey, domain, runId } = Route.useParams();
  return <ClaimRunWorkspace claimKey={claimKey} domain={domain} runId={runId} />;
}
