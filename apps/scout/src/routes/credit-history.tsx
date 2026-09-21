import { createFileRoute } from "@tanstack/react-router";
import { CreditHistoryPage } from "#components/credit-history-page";

export const Route = createFileRoute("/credit-history")({
  ssr: false,
  staticData: { access: "access_account" },
  head: () => ({
    meta: [{ title: "Credit history | TrailScout" }],
  }),
  component: CreditHistoryPage,
});
