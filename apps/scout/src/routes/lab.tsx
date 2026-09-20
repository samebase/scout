import { createFileRoute } from "@tanstack/react-router";
import { labSearch } from "../tasks/model";
import { LabError, LabPage } from "../tasks/page";

export const Route = createFileRoute("/lab")({
  staticData: { access: "access_lab" },
  validateSearch: labSearch,
  head: () => ({ meta: [{ title: "Lab | Scout" }] }),
  component: () => <LabPage search={Route.useSearch()} />,
  errorComponent: LabError,
});
