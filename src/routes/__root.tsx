import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Authenticated } from "convex/react";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "../lib/convex";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import appCss from "../style.css?url";
import { Button } from "#components/ui/button";

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
            <nav
              className="mx-auto flex w-full max-w-2xl flex-wrap px-1 pt-2 [&_[data-slot=button]]:px-1.5 sm:px-2 sm:[&_[data-slot=button]]:px-2.5"
              aria-label="Primary navigation"
            >
              <Button asChild variant="link">
                <Link to="/" activeOptions={{ exact: true }}>
                  Home
                </Link>
              </Button>
              <Button asChild variant="link">
                <Link to="/lab">Lab</Link>
              </Button>
              <Button asChild variant="link">
                <Link to="/scouts">Scouts</Link>
              </Button>
              <Button asChild variant="link">
                <Link to="/products" search={{ product: undefined }}>
                  Products
                </Link>
              </Button>
              <Button asChild variant="link">
                <Link to="/settings">Settings</Link>
              </Button>
            </nav>
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
