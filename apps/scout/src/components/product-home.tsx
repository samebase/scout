import { ProductShell } from "../products/shell";
import { ConversationLobby } from "../products/conversation/page";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { ActivityFeed } from "./activity-feed";

export function ProductHome({ search }: { search: ReviewFeedSearch }) {
  return (
    <ProductShell product="review">
      <main
        id="main-content"
        className="mx-auto max-w-[1120px] px-9 pt-14 pb-16 max-[640px]:px-5 max-[640px]:pt-8"
      >
        <div className="mx-auto mb-14 max-w-[660px]">
          <ConversationLobby kind="review" />
        </div>
        <ActivityFeed search={search} />
      </main>
    </ProductShell>
  );
}
