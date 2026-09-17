import { useState } from "react";
import { ProductShell } from "../products/shell";
import { ConversationLobby } from "../products/conversation/page";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { ActivityFeed } from "./activity-feed";
import { DiscoveryHero } from "./discovery-hero";

export function ProductHome({ search }: { search: ReviewFeedSearch }) {
  const [composing, setComposing] = useState(false);
  return (
    <ProductShell>
      <main id="main-content">
        <DiscoveryHero composing={composing}>
          <div
            className="mx-auto mt-5 max-w-[660px] pb-8"
            onFocusCapture={() => setComposing(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setComposing(false);
            }}
          >
            <ConversationLobby kind="review" showIntroduction={false} />
          </div>
        </DiscoveryHero>
        <div className="mx-auto max-w-[1160px] px-8 pb-16 max-[640px]:px-4">
          <ActivityFeed search={search} />
        </div>
      </main>
    </ProductShell>
  );
}
