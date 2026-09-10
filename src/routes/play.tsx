import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage, ConversationError } from "../products/conversation/page";
import { conversationSearch } from "../products/conversation/model";

export const Route = createFileRoute("/play")({
  staticData: { access: "access_public" },
  validateSearch: conversationSearch,
  head: () => ({ meta: [{ title: "Play with Scout" }] }),
  component: () => <ConversationPage kind="play" search={Route.useSearch()} />,
  errorComponent: ConversationError,
});
