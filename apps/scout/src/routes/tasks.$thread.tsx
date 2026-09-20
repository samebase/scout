import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage, ConversationError } from "../products/conversation/page";
import { conversationSearch } from "../products/conversation/model";

export const Route = createFileRoute("/tasks/$thread")({
  ssr: false,
  staticData: { access: "access_public" },
  validateSearch: conversationSearch,
  head: () => ({ meta: [{ title: "Task | Scout" }] }),
  component: TaskPage,
  errorComponent: ConversationError,
});

function TaskPage() {
  const { thread } = Route.useParams();
  return <ConversationPage kind="review" threadId={thread} search={Route.useSearch()} />;
}
