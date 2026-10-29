import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { SessionProvider, sessionBeforeLoad } from "@samebase/convex-auth-tanstack-start";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import appCss from "../style.css?url";
import { RouteAccessOutlet } from "../components/route-access";
import { AppNavigation } from "#components/app-navigation";
import { PostHogRuntime } from "../components/posthog-runtime";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  ssr: true,
  beforeLoad: sessionBeforeLoad,
  staticData: { access: "access_public" },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "TrailScout",
      },
      {
        name: "description",
        content: "Chat with persistent Scouts and inspect their browser sessions and transcripts.",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/scout-mark.png",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <ClientOnly>
      <p>Not Found</p>
    </ClientOnly>
  ),
  component: RootComponent,
});

// A tab opened before a deploy asks for hashed files that the new version no longer has, so it
// reloads when the deployed version changes.
function useReloadOnNewVersion() {
  const versionId = useQuery(api.siteVersion.get);
  const first = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (versionId === undefined) return;
    first.current ??= versionId;
    if (versionId !== first.current) location.reload();
  }, [versionId]);
}

function RootComponent() {
  const { convexQueryClient, token } = Route.useRouteContext();
  return (
    <RootDocument>
      <SessionProvider client={convexQueryClient.convexClient} token={token}>
        <RootContent />
      </SessionProvider>
    </RootDocument>
  );
}

function RootContent() {
  useReloadOnNewVersion();
  const isHandoff = useMatches({
    select: (matches) => matches.some((match) => match.routeId === "/handoff/$sessionId"),
  });
  return (
    <ScoutSidebarProvider>
      <PostHogRuntime />
      <ClientOnly fallback={<div className="h-16" aria-hidden="true" />}>
        {!isHandoff && <AppNavigation />}
      </ClientOnly>
      <RouteAccessOutlet />
    </ScoutSidebarProvider>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
