import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { z } from "zod";
import { ProductShell } from "../products/shell";
import { ConversationLobby } from "../products/conversation/page";
import type { homeSearch } from "#lib/homeSearch";
import { ActivityFeed } from "./activity-feed";
import { DiscoveryHero } from "./discovery-hero";

export function ProductHome({ search }: { search: z.infer<typeof homeSearch> }) {
  const [composing, setComposing] = useState(false);
  const navigate = useNavigate({ from: "/" });
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
            <ConversationLobby
              kind="review"
              showIntroduction={false}
              siteSelection={
                search.taskSite
                  ? {
                      hostname: search.taskSite,
                      onRemove: () => {
                        void navigate({
                          search: (previous) => ({ ...previous, taskSite: undefined }),
                          replace: true,
                          resetScroll: false,
                        });
                      },
                    }
                  : null
              }
            />
          </div>
        </DiscoveryHero>
        <div className="mx-auto max-w-[1160px] px-8 pb-16 max-[640px]:px-4">
          <ActivityFeed search={{ site: search.site, scope: search.scope }} />
        </div>
      </main>
    </ProductShell>
  );
}
