import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
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

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
