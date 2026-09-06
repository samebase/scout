import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { Authenticated } from "convex/react";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "../lib/convex";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import appCss from "../style.css?url";
import { AppNavigation } from "#components/app-navigation";

export const Route = createRootRoute({
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
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isProductPage =
    pathname === "/" ||
    pathname === "/play" ||
    pathname.startsWith("/play/") ||
    pathname === "/review" ||
    pathname.startsWith("/review/");
  return (
    <RootDocument>
      <ScoutSidebarProvider>
        <ConvexClientProvider>
          {!isProductPage && (
            <Authenticated>
              <AppNavigation />
            </Authenticated>
          )}
          <Outlet />
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
