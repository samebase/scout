import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRoute,
  useMatches,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "../lib/convex";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import appCss from "../style.css?url";
import { RouteAccessOutlet } from "../components/route-access";
import { AppNavigation } from "#components/app-navigation";
import { PostHogRuntime } from "../components/posthog-runtime";

export const Route = createRootRoute({
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
  // Keep the menu with the rendered page while the next route is loading.
  const isProductPage = useMatches({
    select: (matches) =>
      matches.some(
        ({ routeId }) =>
          routeId === "/" ||
          routeId === "/play" ||
          routeId.startsWith("/play/") ||
          routeId.startsWith("/tasks/") ||
          routeId.startsWith("/sites/"),
      ),
  });
  return (
    <RootDocument>
      <ScoutSidebarProvider>
        <ConvexClientProvider>
          <PostHogRuntime />
          <ClientOnly>{!isProductPage && !isHandoff && <AppNavigation />}</ClientOnly>
          <RouteAccessOutlet />
        </ConvexClientProvider>
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
