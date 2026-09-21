import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import appCss from "../style.css?url";
import { RouteAccessOutlet } from "../components/route-access";
import { AppNavigation } from "#components/app-navigation";
import { PostHogRuntime } from "../components/posthog-runtime";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  ssr: true,
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
        title: "Scout",
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

function RootComponent() {
  const isHandoff = useMatches({
    select: (matches) => matches.some((match) => match.routeId === "/handoff/$sessionId"),
  });
  return (
    <RootDocument>
      <ScoutSidebarProvider>
        <PostHogRuntime />
        <ClientOnly fallback={<div className="h-16" aria-hidden="true" />}>
          {!isHandoff && <AppNavigation />}
        </ClientOnly>
        <RouteAccessOutlet />
      </ScoutSidebarProvider>
    </RootDocument>
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
