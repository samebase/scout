import { createFileRoute } from "@tanstack/react-router";
import { agentsSearch } from "../tasks/model";
import { AgentsError, AgentsPage } from "../tasks/page";

export const Route = createFileRoute("/agents")({
  staticData: { access: "access_lab" },
  validateSearch: agentsSearch,
  head: () => ({ meta: [{ title: "Agents | Scout" }] }),
  component: () => <AgentsPage search={Route.useSearch()} />,
  errorComponent: AgentsError,
});
