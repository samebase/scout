import { useNavigate } from "@tanstack/react-router";
import type { z } from "zod";
import { ProductShell } from "../products/shell";
import { ConversationLobby } from "../products/conversation/page";
import type { homeSearch } from "#lib/homeSearch";
import { ActivityFeed } from "./activity-feed";
import { DiscoveryHero } from "./discovery-hero";
import { Suspense } from "react";
import { defaultTerrainSettings } from "#lib/terrain-settings";

export function ProductHome({ search }: { search: z.infer<typeof homeSearch> }) {
  const navigate = useNavigate({ from: "/" });
  return (
    <ProductShell>
      <main id="main-content" className="relative isolate">
        <DiscoveryHero paused={false} settings={defaultTerrainSettings}>
          <ConversationLobby
            kind="review"
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
        </DiscoveryHero>
        <div className="relative mx-auto max-w-page px-8 pb-16 max-[640px]:px-4">
          <Suspense fallback={<div className="min-h-60" aria-busy="true" />}>
            <ActivityFeed search={{ site: search.site, scope: search.scope }} />
          </Suspense>
        </div>
      </main>
    </ProductShell>
  );
}
