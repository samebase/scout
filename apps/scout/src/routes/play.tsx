import { createFileRoute } from "@tanstack/react-router";
import {
  ConversationPage,
  ConversationError,
  ConversationLobby,
} from "../products/conversation/page";
import { playSearch } from "../products/conversation/model";
import { ProductShell } from "../products/shell";

export const Route = createFileRoute("/play")({
  ssr: false,
  staticData: { access: "access_public" },
  validateSearch: playSearch,
  head: () => ({ meta: [{ title: "Play with a Scout | TrailScout" }] }),
  component: PlayPage,
  errorComponent: ConversationError,
});

function PlayPage() {
  const { thread, ...search } = Route.useSearch();
  return thread ? (
    <ConversationPage kind="play" threadId={thread} search={search} />
  ) : (
    <ProductShell>
      <main
        id="main-content"
        className="grid min-h-[calc(100dvh-4rem)] place-items-center px-5 pt-8 pb-[16vh] max-[760px]:pb-[12vh]"
      >
        <ConversationLobby kind="play" siteSelection={null} />
      </main>
    </ProductShell>
  );
}
