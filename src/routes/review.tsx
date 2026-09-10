import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage, ConversationError } from "../products/conversation/page";
import { conversationSearch } from "../products/conversation/model";

export const Route = createFileRoute("/review")({
  staticData: { access: "access_public" },
  validateSearch: conversationSearch,
  head: () => ({ meta: [{ title: "Review with Scout" }] }),
  component: () => <ConversationPage kind="review" search={Route.useSearch()} />,
  errorComponent: ConversationError,
});
