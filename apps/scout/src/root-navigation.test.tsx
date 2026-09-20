// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createControlledPromise,
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ProductShell } from "./products/shell";
import { Route as RootRoute } from "./routes/__root";
import { Route as AboutRoute } from "./routes/about";
import { omitNullish } from "../shared/omitNullish";

vi.mock("./style.css?url", () => ({ default: "data:text/css," }));
vi.mock("./components/posthog-runtime", () => ({ PostHogRuntime: () => null }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useQuery: () => undefined,
}));

afterEach(cleanup);

test.each([
  {
    from: "/",
    to: "/about",
    link: "About",
    before: "Home fixture",
    after: "The internet is a confusing place.",
  },
  {
    from: "/about",
    to: "/",
    link: "Reviews",
    before: "The internet is a confusing place.",
    after: "Home fixture",
  },
])(
  "keeps one menu while $from → $to waits for its route",
  async ({ from, to, link, before, after }) => {
    const routeReady = createControlledPromise<undefined>();
    const home = createRoute({
      getParentRoute: () => RootRoute,
      path: "/",
      staticData: { access: "access_public" },
      loader: () => (to === "/" ? routeReady : undefined),
      component: () => (
        <ProductShell>
          <h1>Home fixture</h1>
        </ProductShell>
      ),
    });
    const about = createRoute({
      getParentRoute: () => RootRoute,
      path: "/about",
      staticData: AboutRoute.options.staticData,
      ...omitNullish({ component: AboutRoute.options.component }),
      loader: () => (to === "/about" ? routeReady : undefined),
    });
    const router = createRouter({
      context: { queryClient: new QueryClient() },
      routeTree: RootRoute.addChildren([home, about]),
      history: createMemoryHistory({ initialEntries: [from] }),
      defaultPreload: false,
    });
    await router.load();
    render(<RouterProvider router={router} />, { container: document });
    const content = await screen.findByRole("heading", { name: before });
    const menu = screen.getByRole("navigation", { name: "Primary navigation" });

    try {
      fireEvent.click(screen.getByRole("link", { name: link }));
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
      expect(screen.getByRole("heading", { name: before })).toBe(content);
      expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toEqual([menu]);
    } finally {
      await act(async () => {
        routeReady.resolve(undefined);
      });
    }

    expect(await screen.findByRole("heading", { name: after })).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toEqual([menu]);
  },
);

test.each([
  { path: "/new-page", url: "/new-page", menuCount: 1 },
  { path: "/handoff/$sessionId", url: "/handoff/session", menuCount: 0 },
])("renders $menuCount menus on a direct visit to $url", async ({ path, url, menuCount }) => {
  const page = createRoute({
    getParentRoute: () => RootRoute,
    path,
    staticData: { access: "access_public" },
    component: () => <h1>Route fixture</h1>,
  });
  const router = createRouter({
    context: { queryClient: new QueryClient() },
    routeTree: RootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });

  expect(await screen.findByRole("heading", { name: "Route fixture" })).toBeTruthy();
  expect(screen.queryAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(
    menuCount,
  );
});
