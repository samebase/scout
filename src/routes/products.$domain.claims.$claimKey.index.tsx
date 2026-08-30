import { createFileRoute } from "@tanstack/react-router";
import { ClaimRunWorkspace } from "#components/claim-run-workspace";

export const Route = createFileRoute("/products/$domain/claims/$claimKey/")({
  component: ClaimRunsIndexPage,
});

function ClaimRunsIndexPage() {
  const { claimKey, domain } = Route.useParams();
  return <ClaimRunWorkspace claimKey={claimKey} domain={domain} />;
}
