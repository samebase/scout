import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
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
        content: "Test web apps through fresh-user journeys and record whether their claims hold.",
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
  return (
    <RootDocument>
      <ScoutSidebarProvider>
        <ConvexClientProvider>
          <Authenticated>
            <AppNavigation />
          </Authenticated>
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
