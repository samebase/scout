import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const convexQueryClient = new ConvexQueryClient(import.meta.env["VITE_CONVEX_URL"]);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        retry: false,
      },
    },
  });
  convexQueryClient.connect(queryClient);
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    Wrap: ({ children }) => (
      <ConvexAuthProvider client={convexQueryClient.convexClient}>{children}</ConvexAuthProvider>
    ),
    defaultPreload: "intent",
    scrollRestoration: true,
    getScrollRestorationKey: (location) => {
      if (location.pathname === "/" || location.pathname.startsWith("/sites/")) {
        // Parent links create new history entries. Reuse each directory view's position.
        const search = new URLSearchParams(location.searchStr);
        if (search.get("scope") === "public") search.delete("scope");
        if (location.pathname.startsWith("/sites/") && search.get("view") === "tasks") {
          search.delete("view");
        }
        search.sort();
        return `${location.pathname}?${search.toString()}`;
      }
      return location.state.__TSR_key || location.href;
    },
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
