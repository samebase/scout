// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { omitNullish } from "../../shared/omitNullish";
import { Route as ScoutsRoute } from "../routes/scouts.index";
import { Route as ScoutRoute } from "../routes/scouts.$slug";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";

const remote = vi.hoisted(() => ({
  action: vi.fn(),
  mutation: vi.fn(),
  scout: {
    _id: "scout-1",
    slug: "conrad",
    websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
    displayName: "Conrad Scout",
    status: "active",
    agentMail: { inboxId: "inbox-1", address: "conrad@example.test" },
    firecrawl: { profileName: "conrad" },
  },
}));

vi.mock("convex/react", () => ({
  useAction: () => remote.action,
  useMutation: () => remote.mutation,
  useQuery: (reference: FunctionReference<"query">) => {
    switch (getFunctionName(reference)) {
      case "scout/scouts:list":
        return [remote.scout];
      case "scout/scouts:get":
        return remote.scout;
      case "scout/serviceAccounts:list":
        return [];
      default:
        throw new Error("Unexpected query: " + getFunctionName(reference));
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

async function openPage(path: string) {
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () => (
      <ScoutSidebarProvider>
        <Outlet />
      </ScoutSidebarProvider>
    ),
  });
  const scouts = createRoute({
    path: "/scouts",
    getParentRoute: () => root,
    component: Outlet,
    staticData: { access: "access_scout_manage" },
  });
  const index = createRoute({
    path: "/",
    staticData: { access: "access_scout_manage" },
    getParentRoute: () => scouts,
    ...omitNullish({
      component: ScoutsRoute.options.component,
      validateSearch: ScoutsRoute.options.validateSearch,
    }),
  });
  const detail = createRoute({
    path: "$slug",
    staticData: { access: "access_scout_manage" },
    getParentRoute: () => scouts,
    ...omitNullish({
      component: ScoutRoute.options.component,
      validateSearch: ScoutRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([scouts.addChildren([index, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test.each([
  { path: "/scouts", button: "Register scout", field: "First name", view: "register" },
  { path: "/scouts/conrad", button: "Add account", field: "Service name", view: "add-account" },
])(
  "restores the $button panel through Back, Forward, and reload",
  async ({ path, button, field, view }) => {
    const router = await openPage(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: button }));
    expect(router.state.location.search).toEqual({ view });
    await user.type(screen.getByRole("textbox", { name: field }), "Private form value");
    const bookmark = router.state.location.href;
    expect(bookmark).not.toContain("Private");
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole("textbox", { name: field })).toBeNull());
    act(() => router.history.forward());
    expect(await screen.findByRole("textbox", { name: field })).toBeTruthy();
    cleanup();
    await openPage(bookmark);
    expect(await screen.findByRole("textbox", { name: field })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: field })).toBeNull());
    expect(remote.action).not.toHaveBeenCalled();
    expect(remote.mutation).not.toHaveBeenCalled();
  },
);
